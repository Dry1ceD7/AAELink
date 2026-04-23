package consumer

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/rs/zerolog/log"

	"github.com/Dry1ceD7/AAELink/services/notify/internal/mailer"
	"github.com/Dry1ceD7/AAELink/services/notify/internal/templates"
)

type Options struct {
	URL          string
	Stream       string
	Subject      string
	Consumer     string
	Inbox        string
	ConnectRetry time.Duration
}

type Worker struct {
	opt    Options
	mailer *mailer.Mailer
	nc     *nats.Conn
	js     nats.JetStreamContext
	sub    *nats.Subscription
}

func New(opt Options, m *mailer.Mailer) *Worker { return &Worker{opt: opt, mailer: m} }

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
		w.handle,
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

func (w *Worker) handle(msg *nats.Msg) {
	ev, err := templates.Decode(msg.Data)
	if err != nil {
		log.Error().Err(err).Bytes("data", msg.Data).Msg("decode event")
		_ = msg.Term()
		return
	}

	subject, body := templates.Render(ev)
	if err := w.mailer.Send([]string{w.opt.Inbox}, subject, body); err != nil {
		log.Error().Err(err).Str("type", ev.Type).Msg("send mail failed")
		_ = msg.NakWithDelay(10 * time.Second)
		return
	}

	log.Info().
		Str("type", ev.Type).
		Int64("ticket", ev.Number).
		Str("to", w.opt.Inbox).
		Msg("email sent")
	_ = msg.Ack()
}
