package repository

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type File struct {
	ID         uuid.UUID
	TicketID   uuid.UUID
	Filename   string
	StorageKey string
	MimeType   string
	FileSize   int64
	UploadedBy uuid.UUID
	UploadedAt time.Time
}

type FileRepo struct {
	pool *pgxpool.Pool
}

func NewFileRepo(pool *pgxpool.Pool) *FileRepo {
	return &FileRepo{pool: pool}
}

func (r *FileRepo) TicketExists(ctx context.Context, ticketID uuid.UUID) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM tickets WHERE id = $1)`, ticketID,
	).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}

func (r *FileRepo) Insert(ctx context.Context, f *File) error {
	if f.ID == uuid.Nil {
		f.ID = uuid.New()
	}
	if f.UploadedAt.IsZero() {
		f.UploadedAt = time.Now().UTC()
	}
	_, err := r.pool.Exec(ctx,
		`INSERT INTO ticket_files
		   (id, ticket_id, filename, storage_key, mime_type, file_size, uploaded_by, uploaded_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		f.ID, f.TicketID, f.Filename, f.StorageKey, f.MimeType, f.FileSize, f.UploadedBy, f.UploadedAt,
	)
	return err
}

func (r *FileRepo) Get(ctx context.Context, id uuid.UUID) (*File, error) {
	var f File
	err := r.pool.QueryRow(ctx,
		`SELECT id, ticket_id, filename, storage_key, mime_type, file_size, uploaded_by, uploaded_at
		   FROM ticket_files WHERE id = $1`, id,
	).Scan(&f.ID, &f.TicketID, &f.Filename, &f.StorageKey, &f.MimeType, &f.FileSize, &f.UploadedBy, &f.UploadedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &f, nil
}

func (r *FileRepo) ListByTicket(ctx context.Context, ticketID uuid.UUID) ([]File, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, ticket_id, filename, storage_key, mime_type, file_size, uploaded_by, uploaded_at
		   FROM ticket_files
		  WHERE ticket_id = $1
		  ORDER BY uploaded_at DESC`, ticketID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]File, 0, 16)
	for rows.Next() {
		var f File
		if err := rows.Scan(&f.ID, &f.TicketID, &f.Filename, &f.StorageKey, &f.MimeType, &f.FileSize, &f.UploadedBy, &f.UploadedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func (r *FileRepo) Delete(ctx context.Context, id uuid.UUID) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM ticket_files WHERE id = $1`, id)
	return err
}
