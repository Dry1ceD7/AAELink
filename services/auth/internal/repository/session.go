package repository

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Session struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	TokenHash string
	ExpiresAt time.Time
	CreatedAt time.Time
}

type SessionRepository struct {
	pool *pgxpool.Pool
}

func NewSessionRepository(pool *pgxpool.Pool) *SessionRepository {
	return &SessionRepository{pool: pool}
}

func (r *SessionRepository) Create(ctx context.Context, userID uuid.UUID, tokenHash string, expiresAt time.Time, ip, ua string) (*Session, error) {
	const q = `
INSERT INTO sessions (user_id, token_hash, expires_at, ip_address, user_agent)
VALUES ($1, $2, $3, NULLIF($4,'')::inet, NULLIF($5,''))
RETURNING id, user_id, token_hash, expires_at, created_at`
	s := &Session{}
	err := r.pool.QueryRow(ctx, q, userID, tokenHash, expiresAt, ip, ua).Scan(
		&s.ID, &s.UserID, &s.TokenHash, &s.ExpiresAt, &s.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return s, nil
}

func (r *SessionRepository) FindByTokenHash(ctx context.Context, tokenHash string) (*Session, error) {
	const q = `
SELECT id, user_id, token_hash, expires_at, created_at
FROM sessions
WHERE token_hash = $1`
	s := &Session{}
	err := r.pool.QueryRow(ctx, q, tokenHash).Scan(
		&s.ID, &s.UserID, &s.TokenHash, &s.ExpiresAt, &s.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return s, nil
}

func (r *SessionRepository) DeleteByTokenHash(ctx context.Context, tokenHash string) error {
	const q = `DELETE FROM sessions WHERE token_hash = $1`
	_, err := r.pool.Exec(ctx, q, tokenHash)
	return err
}

func (r *SessionRepository) DeleteByUser(ctx context.Context, userID uuid.UUID) error {
	const q = `DELETE FROM sessions WHERE user_id = $1`
	_, err := r.pool.Exec(ctx, q, userID)
	return err
}

func (r *SessionRepository) DeleteExpired(ctx context.Context) error {
	const q = `DELETE FROM sessions WHERE expires_at < NOW()`
	_, err := r.pool.Exec(ctx, q)
	return err
}
