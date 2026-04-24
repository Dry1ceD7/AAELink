package templates

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Event mirrors the publisher payload from the ticket service.
// We decode loosely with a map so unknown fields don't break delivery.
type Event struct {
	Type       string         `json:"type"`
	TicketID   string         `json:"ticket_id"`
	Number     int64          `json:"number"`
	Title      string         `json:"title"`
	Status     string         `json:"status"`
	Priority   string         `json:"priority"`
	Actor      string         `json:"actor"`
	AssignedTo string         `json:"assigned_to"`
	Content    string         `json:"content"`
	Timestamp  string         `json:"timestamp"`
	Payload    map[string]any `json:"-"`
	Raw        map[string]any `json:"-"`
}

func Decode(b []byte) (*Event, error) {
	var raw map[string]any
	if err := json.Unmarshal(b, &raw); err != nil {
		return nil, err
	}
	e := &Event{Raw: raw}
	e.Type, _ = raw["type"].(string)
	e.TicketID, _ = raw["ticket_id"].(string)
	e.Timestamp, _ = raw["timestamp"].(string)
	// Prefer the explicit top-level actor (newer events). Falls back to
	// the payload-derived guess for older events still in the queue.
	e.Actor, _ = raw["actor"].(string)

	// Ticket service publishes payload under "payload" (Ticket or Comment struct).
	payload, _ := raw["payload"].(map[string]any)
	if payload == nil {
		// Fallback: some events may be flat
		payload = raw
	}
	e.Payload = payload

	if n, ok := payload["number"].(float64); ok {
		e.Number = int64(n)
	}
	e.Title, _ = payload["title"].(string)
	e.Status, _ = payload["status"].(string)
	e.Priority, _ = payload["priority"].(string)
	if a, ok := payload["assigned_to"].(string); ok {
		e.AssignedTo = a
	}
	// For comment events, payload is a Comment with Content + UserID
	e.Content, _ = payload["content"].(string)
	if e.Actor == "" {
		// Backwards-compat fallback for events that pre-date the
		// explicit `actor` field.
		if uid, ok := payload["user_id"].(string); ok {
			e.Actor = uid
		} else if cb, ok := payload["created_by"].(string); ok {
			e.Actor = cb
		}
	}
	return e, nil
}

// Render produces (subject, body) for the given event. Unknown event types
// fall back to a generic dump so we never silently drop notifications.
func Render(e *Event) (string, string) {
	tag := fmt.Sprintf("[AAELink #%d]", e.Number)
	if e.Number == 0 {
		tag = "[AAELink]"
	}

	switch e.Type {
	case "ticket.created":
		subj := fmt.Sprintf("%s New ticket: %s", tag, e.Title)
		body := joinLines(
			"A new ticket was created.",
			"",
			"Ticket: "+e.Title,
			"Status: "+e.Status,
			"Priority: "+e.Priority,
			"Created by: "+e.Actor,
			"At: "+e.Timestamp,
		)
		return subj, body

	case "ticket.status_changed":
		subj := fmt.Sprintf("%s Status → %s", tag, e.Status)
		body := joinLines(
			"Ticket status changed.",
			"",
			"Ticket: "+e.Title,
			"New status: "+e.Status,
			"Changed by: "+e.Actor,
			"At: "+e.Timestamp,
		)
		return subj, body

	case "ticket.assigned":
		subj := fmt.Sprintf("%s Assigned to %s", tag, shortID(e.AssignedTo))
		body := joinLines(
			"Ticket assigned.",
			"",
			"Ticket: "+e.Title,
			"Assignee: "+e.AssignedTo,
			"Assigned by: "+e.Actor,
			"At: "+e.Timestamp,
		)
		return subj, body

	case "ticket.comment_added":
		subj := fmt.Sprintf("%s New comment on ticket", tag)
		body := joinLines(
			"A new comment was added.",
			"",
			"Ticket ID: "+e.TicketID,
			"Comment: "+truncate(e.Content, 500),
			"Author: "+e.Actor,
			"At: "+e.Timestamp,
		)
		return subj, body
	}

	pretty, _ := json.MarshalIndent(e.Raw, "", "  ")
	return fmt.Sprintf("%s Event: %s", tag, e.Type), string(pretty)
}

func joinLines(lines ...string) string { return strings.Join(lines, "\r\n") }

func shortID(s string) string {
	if len(s) <= 8 {
		return s
	}
	return s[:8]
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
