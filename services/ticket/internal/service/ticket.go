package service

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"

	"github.com/Dry1ceD7/AAELink/services/ticket/internal/events"
	"github.com/Dry1ceD7/AAELink/services/ticket/internal/repository"
	"github.com/Dry1ceD7/AAELink/services/ticket/internal/sse"
)

// routing carries the per-event metadata the SSE hub uses to scope
// delivery (creator, assignee, department).
type routing struct {
	CreatedBy    uuid.UUID
	AssignedTo   *uuid.UUID
	DepartmentID *uuid.UUID
}

func ticketRouting(t *repository.Ticket) routing {
	return routing{
		CreatedBy:    t.CreatedBy,
		AssignedTo:   t.AssignedTo,
		DepartmentID: t.DepartmentID,
	}
}

type TicketService struct {
	tickets  *repository.TicketRepository
	comments *repository.CommentRepository
	pub      *events.Publisher
	hub      *sse.Hub
}

func NewTicketService(t *repository.TicketRepository, c *repository.CommentRepository, p *events.Publisher, h *sse.Hub) *TicketService {
	return &TicketService{tickets: t, comments: c, pub: p, hub: h}
}

func (s *TicketService) Create(ctx context.Context, p repository.CreateTicketParams) (*repository.Ticket, error) {
	t, err := s.tickets.Create(ctx, p)
	if err != nil {
		return nil, err
	}
	s.broadcast("tickets.created", events.Event{
		Type:     "ticket.created",
		TicketID: t.ID.String(),
		Actor:    t.CreatedBy.String(),
		Payload:  t,
	}, ticketRouting(t))
	return t, nil
}

func (s *TicketService) Get(ctx context.Context, id uuid.UUID) (*repository.Ticket, error) {
	return s.tickets.Get(ctx, id)
}

func (s *TicketService) List(ctx context.Context, f repository.ListFilter) ([]repository.Ticket, error) {
	return s.tickets.List(ctx, f)
}

func (s *TicketService) UpdateStatus(ctx context.Context, id uuid.UUID, status string, actor uuid.UUID) (*repository.Ticket, error) {
	t, err := s.tickets.UpdateStatus(ctx, id, status, actor)
	if err != nil {
		return nil, err
	}
	s.broadcast("tickets.status", events.Event{
		Type:     "ticket.status_changed",
		TicketID: t.ID.String(),
		Actor:    actor.String(),
		Payload:  t,
	}, ticketRouting(t))
	return t, nil
}

func (s *TicketService) Assign(ctx context.Context, id, assignee, actor uuid.UUID) (*repository.Ticket, error) {
	t, err := s.tickets.Assign(ctx, id, assignee, actor)
	if err != nil {
		return nil, err
	}
	s.broadcast("tickets.assigned", events.Event{
		Type:     "ticket.assigned",
		TicketID: t.ID.String(),
		Actor:    actor.String(),
		Payload:  t,
	}, ticketRouting(t))
	return t, nil
}

func (s *TicketService) AddComment(ctx context.Context, ticketID, userID uuid.UUID, content string, internal bool) (*repository.Comment, error) {
	c, err := s.comments.Create(ctx, ticketID, userID, content, internal)
	if err != nil {
		return nil, err
	}
	// The hub needs the parent ticket's routing metadata, not the
	// comment's. Tolerate a missing parent (orphan comment) by skipping
	// the broadcast — the persistence already succeeded.
	t, _ := s.tickets.Get(ctx, ticketID)
	r := routing{}
	if t != nil {
		r = ticketRouting(t)
	}
	s.broadcast("tickets.comments", events.Event{
		Type:     "ticket.comment_added",
		TicketID: ticketID.String(),
		Actor:    userID.String(),
		Payload:  c,
	}, r)
	return c, nil
}

func (s *TicketService) ListComments(ctx context.Context, ticketID uuid.UUID) ([]repository.Comment, error) {
	return s.comments.ListByTicket(ctx, ticketID)
}

func (s *TicketService) broadcast(subject string, e events.Event, r routing) {
	if e.Timestamp.IsZero() {
		e.Timestamp = time.Now().UTC()
	}
	if s.pub != nil {
		_ = s.pub.Publish(subject, e)
	}
	if s.hub != nil {
		if b, err := json.Marshal(e); err == nil {
			s.hub.Broadcast(sse.Frame{
				Payload:      b,
				CreatedBy:    r.CreatedBy,
				AssignedTo:   r.AssignedTo,
				DepartmentID: r.DepartmentID,
			})
		}
	}
}
