package repository

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("not found")

type Ticket struct {
	ID           uuid.UUID  `json:"id"`
	Number       int32      `json:"number"`
	Title        string     `json:"title"`
	Description  string     `json:"description"`
	Status       string     `json:"status"`
	Priority     string     `json:"priority"`
	CategoryID   *uuid.UUID `json:"category_id,omitempty"`
	CreatedBy    uuid.UUID  `json:"created_by"`
	AssignedTo   *uuid.UUID `json:"assigned_to,omitempty"`
	DepartmentID *uuid.UUID `json:"department_id,omitempty"`
	ResolvedAt   *time.Time `json:"resolved_at,omitempty"`
	ClosedAt     *time.Time `json:"closed_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

type TicketRepository struct {
	pool *pgxpool.Pool
}

func NewTicketRepository(p *pgxpool.Pool) *TicketRepository {
	return &TicketRepository{pool: p}
}

type CreateTicketParams struct {
	Title        string
	Description  string
	Priority     string
	CategoryID   *uuid.UUID
	CreatedBy    uuid.UUID
	DepartmentID *uuid.UUID
}

func (r *TicketRepository) Create(ctx context.Context, p CreateTicketParams) (*Ticket, error) {
	const q = `
INSERT INTO tickets (title, description, priority, category_id, created_by, department_id)
VALUES ($1, $2, $3::ticket_priority, $4, $5, $6)
RETURNING id, number, title, description, status::text, priority::text, category_id, created_by, assigned_to, department_id, resolved_at, closed_at, created_at, updated_at`
	var t Ticket
	err := r.pool.QueryRow(ctx, q, p.Title, p.Description, p.Priority, p.CategoryID, p.CreatedBy, p.DepartmentID).Scan(
		&t.ID, &t.Number, &t.Title, &t.Description, &t.Status, &t.Priority, &t.CategoryID,
		&t.CreatedBy, &t.AssignedTo, &t.DepartmentID, &t.ResolvedAt, &t.ClosedAt, &t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (r *TicketRepository) Get(ctx context.Context, id uuid.UUID) (*Ticket, error) {
	const q = `
SELECT id, number, title, description, status::text, priority::text, category_id, created_by, assigned_to, department_id, resolved_at, closed_at, created_at, updated_at
FROM tickets
WHERE id = $1 AND deleted_at IS NULL`
	var t Ticket
	err := r.pool.QueryRow(ctx, q, id).Scan(
		&t.ID, &t.Number, &t.Title, &t.Description, &t.Status, &t.Priority, &t.CategoryID,
		&t.CreatedBy, &t.AssignedTo, &t.DepartmentID, &t.ResolvedAt, &t.ClosedAt, &t.CreatedAt, &t.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

type ListFilter struct {
	Status     string
	AssignedTo *uuid.UUID
	CreatedBy  *uuid.UUID
	Limit      int
	Offset     int

	// Scope is applied AFTER the explicit filters to enforce hard
	// authorization boundaries. Use ScopeAll to disable isolation
	// (IT staff). Use ScopeDepartment to limit results to tickets the
	// caller created OR tickets that belong to the caller's department.
	Scope        ListScope
	ScopeUserID  uuid.UUID
	ScopeDeptID  *uuid.UUID
}

type ListScope int

const (
	ScopeAll        ListScope = iota
	ScopeDepartment           // own + caller's department
)

func (r *TicketRepository) List(ctx context.Context, f ListFilter) ([]Ticket, error) {
	if f.Limit <= 0 || f.Limit > 200 {
		f.Limit = 50
	}
	q := `
SELECT id, number, title, description, status::text, priority::text, category_id, created_by, assigned_to, department_id, resolved_at, closed_at, created_at, updated_at
FROM tickets
WHERE deleted_at IS NULL`
	args := []any{}
	if f.Status != "" {
		args = append(args, f.Status)
		q += " AND status = $" + itoa(len(args)) + "::ticket_status"
	}
	if f.AssignedTo != nil {
		args = append(args, *f.AssignedTo)
		q += " AND assigned_to = $" + itoa(len(args))
	}
	if f.CreatedBy != nil {
		args = append(args, *f.CreatedBy)
		q += " AND created_by = $" + itoa(len(args))
	}
	if f.Scope == ScopeDepartment {
		args = append(args, f.ScopeUserID)
		userClause := "created_by = $" + itoa(len(args))
		if f.ScopeDeptID != nil {
			args = append(args, *f.ScopeDeptID)
			deptClause := "department_id = $" + itoa(len(args))
			q += " AND (" + userClause + " OR " + deptClause + ")"
		} else {
			q += " AND " + userClause
		}
	}
	args = append(args, f.Limit)
	q += " ORDER BY created_at DESC LIMIT $" + itoa(len(args))
	args = append(args, f.Offset)
	q += " OFFSET $" + itoa(len(args))

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Ticket, 0)
	for rows.Next() {
		var t Ticket
		if err := rows.Scan(
			&t.ID, &t.Number, &t.Title, &t.Description, &t.Status, &t.Priority, &t.CategoryID,
			&t.CreatedBy, &t.AssignedTo, &t.DepartmentID, &t.ResolvedAt, &t.ClosedAt, &t.CreatedAt, &t.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (r *TicketRepository) UpdateStatus(ctx context.Context, id uuid.UUID, status string, actor uuid.UUID) (*Ticket, error) {
	const q = `
UPDATE tickets
SET status = $2::ticket_status,
    resolved_at = CASE WHEN $2 IN ('resolved','closed') AND resolved_at IS NULL THEN NOW() ELSE resolved_at END,
    closed_at   = CASE WHEN $2 = 'closed' AND closed_at IS NULL THEN NOW() ELSE closed_at END,
    updated_at  = NOW()
WHERE id = $1 AND deleted_at IS NULL
RETURNING id, number, title, description, status::text, priority::text, category_id, created_by, assigned_to, department_id, resolved_at, closed_at, created_at, updated_at`
	var t Ticket
	err := r.pool.QueryRow(ctx, q, id, status).Scan(
		&t.ID, &t.Number, &t.Title, &t.Description, &t.Status, &t.Priority, &t.CategoryID,
		&t.CreatedBy, &t.AssignedTo, &t.DepartmentID, &t.ResolvedAt, &t.ClosedAt, &t.CreatedAt, &t.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	_ = r.audit(ctx, id, actor, "status_changed", nil, map[string]any{"status": status})
	return &t, nil
}

func (r *TicketRepository) Assign(ctx context.Context, id uuid.UUID, assignee uuid.UUID, actor uuid.UUID) (*Ticket, error) {
	const q = `
UPDATE tickets
SET assigned_to = $2, updated_at = NOW()
WHERE id = $1 AND deleted_at IS NULL
RETURNING id, number, title, description, status::text, priority::text, category_id, created_by, assigned_to, department_id, resolved_at, closed_at, created_at, updated_at`
	var t Ticket
	err := r.pool.QueryRow(ctx, q, id, assignee).Scan(
		&t.ID, &t.Number, &t.Title, &t.Description, &t.Status, &t.Priority, &t.CategoryID,
		&t.CreatedBy, &t.AssignedTo, &t.DepartmentID, &t.ResolvedAt, &t.ClosedAt, &t.CreatedAt, &t.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	_ = r.audit(ctx, id, actor, "assigned", nil, map[string]any{"assignee_id": assignee.String()})
	return &t, nil
}

func (r *TicketRepository) audit(ctx context.Context, ticketID, userID uuid.UUID, action string, oldVal, newVal any) error {
	const q = `INSERT INTO ticket_audit_log (ticket_id, user_id, action, old_value, new_value) VALUES ($1, $2, $3, $4, $5)`
	oldJSON, err := toJSON(oldVal)
	if err != nil {
		return err
	}
	newJSON, err := toJSON(newVal)
	if err != nil {
		return err
	}
	_, err = r.pool.Exec(ctx, q, ticketID, userID, action, oldJSON, newJSON)
	return err
}

func toJSON(v any) ([]byte, error) {
	if v == nil {
		return nil, nil
	}
	return json.Marshal(v)
}

func itoa(i int) string {
	const digits = "0123456789"
	if i == 0 {
		return "0"
	}
	buf := make([]byte, 0, 4)
	for i > 0 {
		buf = append([]byte{digits[i%10]}, buf...)
		i /= 10
	}
	return string(buf)
}
