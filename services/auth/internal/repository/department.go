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

// Department represents an org department row.
type Department struct {
	ID        uuid.UUID
	Name      map[string]string
	Slug      string
	IsITDept  bool
	CreatedAt time.Time
	UpdatedAt time.Time
}

type DepartmentRepository struct {
	pool *pgxpool.Pool
}

func NewDepartmentRepository(pool *pgxpool.Pool) *DepartmentRepository {
	return &DepartmentRepository{pool: pool}
}

func (r *DepartmentRepository) List(ctx context.Context) ([]Department, error) {
	const q = `
SELECT id, name, slug, is_it_dept, created_at, updated_at
FROM departments
ORDER BY slug ASC`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Department, 0, 16)
	for rows.Next() {
		var d Department
		var raw []byte
		if err := rows.Scan(&d.ID, &raw, &d.Slug, &d.IsITDept, &d.CreatedAt, &d.UpdatedAt); err != nil {
			return nil, err
		}
		d.Name = map[string]string{}
		_ = json.Unmarshal(raw, &d.Name)
		out = append(out, d)
	}
	return out, rows.Err()
}

func (r *DepartmentRepository) FindByID(ctx context.Context, id uuid.UUID) (*Department, error) {
	const q = `
SELECT id, name, slug, is_it_dept, created_at, updated_at
FROM departments WHERE id = $1`
	var d Department
	var raw []byte
	err := r.pool.QueryRow(ctx, q, id).Scan(&d.ID, &raw, &d.Slug, &d.IsITDept, &d.CreatedAt, &d.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	d.Name = map[string]string{}
	_ = json.Unmarshal(raw, &d.Name)
	return &d, nil
}

type CreateDepartmentParams struct {
	Slug     string
	Name     map[string]string
	IsITDept bool
}

func (r *DepartmentRepository) Create(ctx context.Context, p CreateDepartmentParams) (*Department, error) {
	raw, err := json.Marshal(p.Name)
	if err != nil {
		return nil, err
	}
	const q = `
INSERT INTO departments (name, slug, is_it_dept)
VALUES ($1, $2, $3)
RETURNING id, name, slug, is_it_dept, created_at, updated_at`
	var d Department
	var out []byte
	err = r.pool.QueryRow(ctx, q, raw, p.Slug, p.IsITDept).Scan(
		&d.ID, &out, &d.Slug, &d.IsITDept, &d.CreatedAt, &d.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	d.Name = map[string]string{}
	_ = json.Unmarshal(out, &d.Name)
	return &d, nil
}

type UpdateDepartmentParams struct {
	Slug     *string
	Name     map[string]string
	IsITDept *bool
}

func (r *DepartmentRepository) Update(ctx context.Context, id uuid.UUID, p UpdateDepartmentParams) error {
	var nameJSON any
	if p.Name != nil {
		b, err := json.Marshal(p.Name)
		if err != nil {
			return err
		}
		nameJSON = b
	}
	const q = `
UPDATE departments SET
  slug       = COALESCE($2, slug),
  name       = COALESCE($3::jsonb, name),
  is_it_dept = COALESCE($4, is_it_dept),
  updated_at = NOW()
WHERE id = $1`
	ct, err := r.pool.Exec(ctx, q, id, p.Slug, nameJSON, p.IsITDept)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *DepartmentRepository) Delete(ctx context.Context, id uuid.UUID) error {
	const q = `DELETE FROM departments WHERE id = $1`
	ct, err := r.pool.Exec(ctx, q, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
