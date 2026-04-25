package repository

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Request struct {
	ID          uuid.UUID  `json:"id"`
	Requester   string     `json:"requester"`
	Subject     string     `json:"subject"`
	Message     string     `json:"message"`
	Status      string     `json:"status"`
	CreatedAt   time.Time  `json:"created_at"`
	LastMessage *time.Time `json:"last_message_at,omitempty"`
}

type CreateParams struct {
	Requester string
	Subject   string
	Message   string
}

type Repository struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

func (r *Repository) Create(ctx context.Context, p CreateParams) (*Request, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var out Request
	const rq = `
INSERT INTO support_requests (requester, subject, status)
VALUES ($1, $2, 'queued')
RETURNING id, requester, subject, status, created_at, last_message_at`
	if err := tx.QueryRow(ctx, rq, p.Requester, p.Subject).Scan(
		&out.ID, &out.Requester, &out.Subject, &out.Status, &out.CreatedAt, &out.LastMessage,
	); err != nil {
		return nil, err
	}

	const mq = `
INSERT INTO support_messages (request_id, sender_kind, sender_label, body)
VALUES ($1, 'requester', $2, $3)`
	if _, err := tx.Exec(ctx, mq, out.ID, p.Requester, p.Message); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE support_requests SET last_message_at = NOW() WHERE id = $1`, out.ID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	out.Message = p.Message
	return &out, nil
}

func (r *Repository) List(ctx context.Context, limit int) ([]Request, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	const q = `
SELECT id, requester, subject, status, created_at, last_message_at
FROM support_requests
ORDER BY created_at DESC
LIMIT $1`
	rows, err := r.pool.Query(ctx, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Request, 0, limit)
	for rows.Next() {
		var req Request
		if err := rows.Scan(&req.ID, &req.Requester, &req.Subject, &req.Status, &req.CreatedAt, &req.LastMessage); err != nil {
			return nil, err
		}
		out = append(out, req)
	}
	return out, rows.Err()
}
