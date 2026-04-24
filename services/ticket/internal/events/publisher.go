package events

import (
	"encoding/json"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/rs/zerolog/log"
)

const StreamName = "TICKETS"

type Publisher struct {
	js nats.JetStreamContext
}

func NewPublisher(url string) (*Publisher, func(), error) {
	nc, err := nats.Connect(url,
		nats.Name("aaelink-ticket"),
		nats.MaxReconnects(-1),
		nats.ReconnectWait(2*time.Second),
	)
	if err != nil {
		return nil, nil, err
	}
	js, err := nc.JetStream()
	if err != nil {
		nc.Close()
		return nil, nil, err
	}

	if _, err := js.StreamInfo(StreamName); err != nil {
		_, err = js.AddStream(&nats.StreamConfig{
			Name:     StreamName,
			Subjects: []string{"tickets.>"},
			Storage:  nats.FileStorage,
			MaxAge:   7 * 24 * time.Hour,
		})
		if err != nil {
			log.Warn().Err(err).Msg("create jetstream stream failed; continuing")
		}
	}

	closer := func() { nc.Close() }
	return &Publisher{js: js}, closer, nil
}

type Event struct {
	Type      string    `json:"type"`
	TicketID  string    `json:"ticket_id"`
	// Actor is the user ID of whoever triggered the event (creator,
	// commenter, or admin who changed status / assignment). Lets the
	// notify worker exclude self-actions from outbound mail.
	Actor     string    `json:"actor,omitempty"`
	Timestamp time.Time `json:"timestamp"`
	Payload   any       `json:"payload,omitempty"`
}

func (p *Publisher) Publish(subject string, e Event) error {
	if e.Timestamp.IsZero() {
		e.Timestamp = time.Now().UTC()
	}
	b, err := json.Marshal(e)
	if err != nil {
		return err
	}
	_, err = p.js.Publish(subject, b)
	return err
}
