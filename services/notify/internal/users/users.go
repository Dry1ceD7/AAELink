// Package users gives the notify worker read-only access to the auth
// database so each ticket event can be routed to the verified email
// address(es) of the relevant recipients (creator, assignee, IT staff).
package users

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// User is a thin projection: just what the mailer needs.
type User struct {
	ID           uuid.UUID
	Email        string
	DisplayName  string
	IsActive     bool
	IsITDept     bool
	IsSuperAdmin bool
	DepartmentID *uuid.UUID
}

type Resolver struct {
	pool *pgxpool.Pool
}

// New opens a small pool against the auth database. The caller is
// responsible for closing it via the returned shutdown function.
func New(ctx context.Context, dsn string) (*Resolver, func(), error) {
	if dsn == "" {
		return nil, func() {}, errors.New("auth database url is empty")
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, nil, err
	}
	cfg.MaxConns = 4
	cfg.MinConns = 0
	cfg.MaxConnIdleTime = 5 * time.Minute
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, nil, err
	}
	return &Resolver{pool: pool}, pool.Close, nil
}

// FindByID returns the user (and their department's IT flag) or nil if
// the id cannot be resolved. Errors other than "not found" propagate.
func (r *Resolver) FindByID(ctx context.Context, id uuid.UUID) (*User, error) {
	if r == nil || r.pool == nil {
		return nil, nil
	}
	const q = `
SELECT u.id, u.email, u.display_name, u.is_active, u.department_id,
       COALESCE(d.is_it_dept, false), COALESCE(u.is_super_admin, false)
FROM users u
LEFT JOIN departments d ON d.id = u.department_id
WHERE u.id = $1 AND u.deleted_at IS NULL`
	var out User
	err := r.pool.QueryRow(ctx, q, id).Scan(
		&out.ID, &out.Email, &out.DisplayName, &out.IsActive, &out.DepartmentID, &out.IsITDept, &out.IsSuperAdmin,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// ITStaff returns the verified emails of every active member of an
// IT-flagged department + every active user that carries the it_admin or
// it_employee role. Used as the default routing target for new tickets
// that do not yet have an explicit assignee.
func (r *Resolver) ITStaff(ctx context.Context) ([]User, error) {
	if r == nil || r.pool == nil {
		return nil, nil
	}
	const q = `
SELECT DISTINCT u.id, u.email, u.display_name, u.is_active, u.department_id,
       COALESCE(d.is_it_dept, false), COALESCE(u.is_super_admin, false)
FROM users u
LEFT JOIN departments d ON d.id = u.department_id
LEFT JOIN user_roles ur ON ur.user_id = u.id
LEFT JOIN roles r ON r.id = ur.role_id
WHERE u.deleted_at IS NULL
  AND u.is_active = true
  AND (
    COALESCE(d.is_it_dept, false) = true
    OR COALESCE(u.is_super_admin, false) = true
    OR r.name IN ('super_admin', 'it_admin', 'it_employee')
  )
ORDER BY u.display_name`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]User, 0, 8)
	for rows.Next() {
		var u User
		if err := rows.Scan(
			&u.ID, &u.Email, &u.DisplayName, &u.IsActive, &u.DepartmentID, &u.IsITDept, &u.IsSuperAdmin,
		); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}
