package repository

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/google/uuid"
)

type Comment struct {
	ID         uuid.UUID `json:"id"`
	TicketID   uuid.UUID `json:"ticket_id"`
	UserID     uuid.UUID `json:"user_id"`
	Content    string    `json:"content"`
	IsInternal bool      `json:"is_internal"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type CommentRepository struct {
	pool *pgxpool.Pool
}

func NewCommentRepository(p *pgxpool.Pool) *CommentRepository {
	return &CommentRepository{pool: p}
}

func (r *CommentRepository) Create(ctx context.Context, ticketID, userID uuid.UUID, content string, internal bool) (*Comment, error) {
	const q = `
INSERT INTO ticket_comments (ticket_id, user_id, content, is_internal)
VALUES ($1, $2, $3, $4)
RETURNING id, ticket_id, user_id, content, is_internal, created_at, updated_at`
	var c Comment
	err := r.pool.QueryRow(ctx, q, ticketID, userID, content, internal).Scan(
		&c.ID, &c.TicketID, &c.UserID, &c.Content, &c.IsInternal, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *CommentRepository) ListByTicket(ctx context.Context, ticketID uuid.UUID) ([]Comment, error) {
	const q = `
SELECT id, ticket_id, user_id, content, is_internal, created_at, updated_at
FROM ticket_comments
WHERE ticket_id = $1 AND deleted_at IS NULL
ORDER BY created_at ASC`
	rows, err := r.pool.Query(ctx, q, ticketID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Comment, 0)
	for rows.Next() {
		var c Comment
		if err := rows.Scan(&c.ID, &c.TicketID, &c.UserID, &c.Content, &c.IsInternal, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
