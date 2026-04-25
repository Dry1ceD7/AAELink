package repository

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Document struct {
	ID         uuid.UUID `json:"id"`
	OwnerID    uuid.UUID `json:"owner_id"`
	Filename   string    `json:"filename"`
	MimeType   string    `json:"mime_type"`
	FileSize   int64     `json:"file_size"`
	StorageKey string    `json:"storage_key"`
	Status     string    `json:"status"`
	Version    int       `json:"version"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type Operation struct {
	ID         uuid.UUID      `json:"id"`
	DocumentID uuid.UUID      `json:"document_id"`
	Operation  string         `json:"operation"`
	Status     string         `json:"status"`
	Parameters map[string]any `json:"parameters"`
	CreatedBy  uuid.UUID      `json:"created_by"`
	CreatedAt  time.Time      `json:"created_at"`
}

type Repository struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

func (r *Repository) RegisterDocument(ctx context.Context, owner uuid.UUID, filename, mimeType string, size int64, key string) (*Document, error) {
	const q = `
INSERT INTO documents (owner_id, filename, mime_type, file_size, storage_key)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, owner_id, filename, mime_type, file_size, storage_key, status, version, created_at, updated_at`
	var d Document
	err := r.pool.QueryRow(ctx, q, owner, filename, mimeType, size, key).Scan(
		&d.ID, &d.OwnerID, &d.Filename, &d.MimeType, &d.FileSize, &d.StorageKey, &d.Status, &d.Version, &d.CreatedAt, &d.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &d, nil
}

func (r *Repository) QueueOperation(ctx context.Context, documentID, actor uuid.UUID, op string, params map[string]any) (*Operation, error) {
	raw, err := json.Marshal(params)
	if err != nil {
		return nil, err
	}
	const q = `
INSERT INTO document_operations (document_id, operation, parameters, created_by)
VALUES ($1, $2, $3::jsonb, $4)
RETURNING id, document_id, operation, status, parameters, created_by, created_at`
	var out Operation
	var paramsRaw []byte
	err = r.pool.QueryRow(ctx, q, documentID, op, raw, actor).Scan(
		&out.ID, &out.DocumentID, &out.Operation, &out.Status, &paramsRaw, &out.CreatedBy, &out.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(paramsRaw, &out.Parameters)
	return &out, nil
}

func (r *Repository) List(ctx context.Context, owner uuid.UUID, isGlobal bool) ([]Document, error) {
	q := `
SELECT id, owner_id, filename, mime_type, file_size, storage_key, status, version, created_at, updated_at
FROM documents`
	args := []any{}
	if !isGlobal {
		args = append(args, owner)
		q += " WHERE owner_id = $1"
	}
	q += " ORDER BY created_at DESC LIMIT 100"
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Document, 0)
	for rows.Next() {
		var d Document
		if err := rows.Scan(&d.ID, &d.OwnerID, &d.Filename, &d.MimeType, &d.FileSize, &d.StorageKey, &d.Status, &d.Version, &d.CreatedAt, &d.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}
