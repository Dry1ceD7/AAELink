package consumer

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/nats-io/nats.go"
	"github.com/rs/zerolog/log"

	"github.com/Dry1ceD7/AAELink/services/notify/internal/mailer"
	"github.com/Dry1ceD7/AAELink/services/notify/internal/templates"
	"github.com/Dry1ceD7/AAELink/services/notify/internal/users"
)

type Options struct {
	URL          string
	Stream       string
	Subject      string
	Consumer     string
	Inbox        string // fallback recipient when nobody can be resolved
	ConnectRetry time.Duration
}

type Worker struct {
	opt    Options
	mailer *mailer.Mailer
	users  *users.Resolver
	nc     *nats.Conn
	js     nats.JetStreamContext
	sub    *nats.Subscription
}

func New(opt Options, m *mailer.Mailer, u *users.Resolver) *Worker {
	return &Worker{opt: opt, mailer: m, users: u}
}

// Start connects to NATS, ensures a stream + durable pull-style push consumer exists,
// and dispatches each message to the email pipeline. Blocks until ctx is done.
func (w *Worker) Start(ctx context.Context) error {
	if err := w.connect(ctx); err != nil {
		return err
	}
	defer func() {
		if w.sub != nil {
			_ = w.sub.Unsubscribe()
		}
		if w.nc != nil {
			w.nc.Close()
		}
	}()

	if err := w.ensureStream(); err != nil {
		return fmt.Errorf("ensure stream: %w", err)
	}

	sub, err := w.js.Subscribe(
		w.opt.Subject,
		w.makeHandler(ctx),
		nats.Durable(w.opt.Consumer),
		nats.ManualAck(),
		nats.AckWait(30*time.Second),
		nats.DeliverNew(),
	)
	if err != nil {
		return fmt.Errorf("subscribe: %w", err)
	}
	w.sub = sub

	log.Info().
		Str("stream", w.opt.Stream).
		Str("subject", w.opt.Subject).
		Str("consumer", w.opt.Consumer).
		Msg("notify worker subscribed")

	<-ctx.Done()
	log.Info().Msg("notify worker stopping")
	return nil
}

func (w *Worker) connect(ctx context.Context) error {
	retry := w.opt.ConnectRetry
	if retry <= 0 {
		retry = 2 * time.Second
	}

	for {
		nc, err := nats.Connect(w.opt.URL,
			nats.Name("aaelink-notify"),
			nats.Timeout(5*time.Second),
			nats.MaxReconnects(-1),
			nats.ReconnectWait(retry),
		)
		if err == nil {
			js, jsErr := nc.JetStream()
			if jsErr == nil {
				w.nc = nc
				w.js = js
				log.Info().Str("url", w.opt.URL).Msg("nats connected")
				return nil
			}
			nc.Close()
			err = jsErr
		}

		log.Warn().Err(err).Dur("retry_in", retry).Msg("nats connect failed, retrying")
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(retry):
		}
	}
}

func (w *Worker) ensureStream() error {
	_, err := w.js.StreamInfo(w.opt.Stream)
	if err == nil {
		return nil
	}
	if !errors.Is(err, nats.ErrStreamNotFound) {
		return err
	}
	_, err = w.js.AddStream(&nats.StreamConfig{
		Name:      w.opt.Stream,
		Subjects:  []string{w.opt.Subject},
		Retention: nats.LimitsPolicy,
		Storage:   nats.FileStorage,
		MaxAge:    7 * 24 * time.Hour,
	})
	return err
}

// makeHandler captures ctx so each message handler has access to a
// cancellable context for short-lived database lookups.
func (w *Worker) makeHandler(parent context.Context) nats.MsgHandler {
	return func(msg *nats.Msg) {
		// Bound each lookup so a slow DB never blocks ack timeout.
		ctx, cancel := context.WithTimeout(parent, 10*time.Second)
		defer cancel()
		w.handle(ctx, msg)
	}
}

func (w *Worker) handle(ctx context.Context, msg *nats.Msg) {
	ev, err := templates.Decode(msg.Data)
	if err != nil {
		log.Error().Err(err).Bytes("data", msg.Data).Msg("decode event")
		_ = msg.Term()
		return
	}

	// Skip purely-internal comments — those are IT-only chatter and must
	// never go out by email.
	if ev.Type == "ticket.comment_added" && commentIsInternal(ev) {
		log.Debug().Str("ticket", ev.TicketID).Msg("internal comment skipped")
		_ = msg.Ack()
		return
	}

	recipients, err := w.recipientsFor(ctx, ev)
	if err != nil {
		log.Error().Err(err).Str("type", ev.Type).Msg("resolve recipients failed")
		_ = msg.NakWithDelay(15 * time.Second)
		return
	}
	if len(recipients) == 0 {
		log.Info().Str("type", ev.Type).Msg("no recipients — skipping")
		_ = msg.Ack()
		return
	}

	subject, body := templates.Render(ev)
	for _, addr := range recipients {
		if err := w.mailer.Send([]string{addr}, subject, body); err != nil {
			log.Error().Err(err).Str("type", ev.Type).Str("to", addr).Msg("send mail failed")
			_ = msg.NakWithDelay(15 * time.Second)
			return
		}
		log.Info().
			Str("type", ev.Type).
			Int64("ticket", ev.Number).
			Str("to", addr).
			Msg("email sent")
	}
	_ = msg.Ack()
}

// commentIsInternal returns true when the payload is a Comment with
// is_internal = true.
func commentIsInternal(ev *templates.Event) bool {
	if ev == nil || ev.Payload == nil {
		return false
	}
	if v, ok := ev.Payload["is_internal"].(bool); ok {
		return v
	}
	return false
}

// recipientsFor returns the deduplicated, lowercased list of email
// addresses to notify for the given event. The actor is excluded so the
// person performing the action does not get a redundant notice.
func (w *Worker) recipientsFor(ctx context.Context, ev *templates.Event) ([]string, error) {
	actor := strings.TrimSpace(ev.Actor)
	creator := payloadID(ev, "created_by")
	assignee := payloadID(ev, "assigned_to")

	out := newRecipientSet()
	out.excludeID(actor)

	switch ev.Type {
	case "ticket.created":
		// Creator gets a confirmation. IT staff (or the explicit
		// assignee, if already set) gets a fresh-work alert.
		if u := w.lookup(ctx, creator); u != nil {
			out.add(u)
		}
		if assignee != uuid.Nil.String() && assignee != "" {
			if u := w.lookup(ctx, assignee); u != nil {
				out.add(u)
			}
		} else {
			it, err := w.itStaff(ctx)
			if err != nil {
				return nil, err
			}
			for i := range it {
				out.add(&it[i])
			}
		}
	case "ticket.assigned":
		// New assignee learns they own the ticket. Creator learns who
		// is on it now.
		if u := w.lookup(ctx, assignee); u != nil {
			out.add(u)
		}
		if u := w.lookup(ctx, creator); u != nil {
			out.add(u)
		}
	case "ticket.status_changed":
		if u := w.lookup(ctx, creator); u != nil {
			out.add(u)
		}
		if u := w.lookup(ctx, assignee); u != nil {
			out.add(u)
		}
	case "ticket.comment_added":
		if u := w.lookup(ctx, creator); u != nil {
			out.add(u)
		}
		if u := w.lookup(ctx, assignee); u != nil {
			out.add(u)
		}
	default:
		// Unknown event types fall back to IT so we never silently drop
		// a notification that operators may need.
		it, err := w.itStaff(ctx)
		if err != nil {
			return nil, err
		}
		for i := range it {
			out.add(&it[i])
		}
	}

	addrs := out.emails()
	if len(addrs) == 0 && w.opt.Inbox != "" {
		addrs = []string{w.opt.Inbox}
	}
	return addrs, nil
}

func (w *Worker) lookup(ctx context.Context, raw string) *users.User {
	if w.users == nil || raw == "" {
		return nil
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return nil
	}
	u, err := w.users.FindByID(ctx, id)
	if err != nil {
		log.Warn().Err(err).Str("user", raw).Msg("user lookup failed")
		return nil
	}
	if u == nil || !u.IsActive {
		return nil
	}
	return u
}

func (w *Worker) itStaff(ctx context.Context) ([]users.User, error) {
	if w.users == nil {
		return nil, nil
	}
	return w.users.ITStaff(ctx)
}

func payloadID(ev *templates.Event, field string) string {
	if ev == nil || ev.Payload == nil {
		return ""
	}
	v, _ := ev.Payload[field].(string)
	return v
}

// recipientSet deduplicates by user ID first, then by lowercased email.
// It also lets the caller exclude the actor so they never email
// themselves.
type recipientSet struct {
	excludedIDs map[string]struct{}
	byEmail     map[string]string // lowercased email → "Name <email>" or raw email
	order       []string
}

func newRecipientSet() *recipientSet {
	return &recipientSet{
		excludedIDs: map[string]struct{}{},
		byEmail:     map[string]string{},
	}
}

func (r *recipientSet) excludeID(id string) {
	id = strings.TrimSpace(id)
	if id != "" {
		r.excludedIDs[id] = struct{}{}
	}
}

func (r *recipientSet) add(u *users.User) {
	if u == nil || u.Email == "" {
		return
	}
	if _, skip := r.excludedIDs[u.ID.String()]; skip {
		return
	}
	key := strings.ToLower(strings.TrimSpace(u.Email))
	if key == "" {
		return
	}
	if _, exists := r.byEmail[key]; exists {
		return
	}
	r.byEmail[key] = key
	r.order = append(r.order, key)
}

func (r *recipientSet) emails() []string {
	out := make([]string, 0, len(r.order))
	for _, k := range r.order {
		out = append(out, r.byEmail[k])
	}
	return out
}
