package sse

import (
	"sync"

	"github.com/google/uuid"
)

// Subscriber describes a single connected SSE client. The set of fields
// here is intentionally tiny: the hub's only job is to decide whether a
// given event payload should be delivered to a particular client. The
// HTTP layer enforces authentication; we just enforce isolation.
type Subscriber struct {
	UserID       uuid.UUID
	IsITStaff    bool
	DepartmentID *uuid.UUID
	ch           chan Frame
}

// Frame is a delivery unit. Routing is metadata sourced from the same
// fields the REST list/get handlers use, so isolation rules stay aligned.
type Frame struct {
	Payload      []byte
	CreatedBy    uuid.UUID
	AssignedTo   *uuid.UUID
	DepartmentID *uuid.UUID
}

// Hub fan-outs ticket events to subscribed SSE clients applying the same
// isolation rules as the REST list endpoint:
//   - IT staff (it_admin / it_employee / IT-flagged dept) receive every event
//   - everyone else receives only events for tickets they created OR for
//     tickets that belong to their department
type Hub struct {
	mu      sync.RWMutex
	clients map[*Subscriber]struct{}
}

func NewHub() *Hub {
	return &Hub{clients: make(map[*Subscriber]struct{})}
}

// Subscribe registers a new client and returns the subscription handle
// (use Channel() for events, Close() / Hub.Unsubscribe() to detach).
func (h *Hub) Subscribe(s Subscriber) *Subscriber {
	s.ch = make(chan Frame, 16)
	h.mu.Lock()
	h.clients[&s] = struct{}{}
	h.mu.Unlock()
	return &s
}

// Channel returns the receive-only event channel for this subscriber.
func (s *Subscriber) Channel() <-chan Frame {
	if s == nil {
		return nil
	}
	return s.ch
}

func (h *Hub) Unsubscribe(s *Subscriber) {
	if s == nil {
		return
	}
	h.mu.Lock()
	if _, ok := h.clients[s]; ok {
		delete(h.clients, s)
		close(s.ch)
	}
	h.mu.Unlock()
}

// Broadcast delivers a frame to every subscriber that is allowed to see
// the event. Drops messages silently when a subscriber is too slow rather
// than blocking the publisher.
func (h *Hub) Broadcast(f Frame) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for sub := range h.clients {
		if !sub.allowed(f) {
			continue
		}
		select {
		case sub.ch <- f:
		default:
		}
	}
}

func (s *Subscriber) allowed(f Frame) bool {
	if s == nil {
		return false
	}
	if s.IsITStaff {
		return true
	}
	if s.UserID == f.CreatedBy {
		return true
	}
	if f.AssignedTo != nil && *f.AssignedTo == s.UserID {
		return true
	}
	if s.DepartmentID != nil && f.DepartmentID != nil && *s.DepartmentID == *f.DepartmentID {
		return true
	}
	return false
}
