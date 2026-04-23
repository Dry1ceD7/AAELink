package repository

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/google/uuid"
)

var ErrNotFound = errors.New("not found")

type User struct {
	ID              uuid.UUID
	Email           string
	PasswordHash    string
	DisplayName     string
	DepartmentID    *uuid.UUID
	PreferredLocale string
	IsActive        bool
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type UserRepository struct {
	pool *pgxpool.Pool
}

func NewUserRepository(pool *pgxpool.Pool) *UserRepository {
	return &UserRepository{pool: pool}
}

func (r *UserRepository) Create(ctx context.Context, email, passwordHash, displayName, locale string, departmentID *uuid.UUID) (*User, error) {
	const q = `
INSERT INTO users (email, password_hash, display_name, preferred_locale, department_id)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, email, password_hash, display_name, department_id, preferred_locale, is_active, created_at, updated_at`
	u := &User{}
	err := r.pool.QueryRow(ctx, q, email, passwordHash, displayName, locale, departmentID).Scan(
		&u.ID, &u.Email, &u.PasswordHash, &u.DisplayName,
		&u.DepartmentID, &u.PreferredLocale, &u.IsActive,
		&u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return u, nil
}

func (r *UserRepository) FindByEmail(ctx context.Context, email string) (*User, error) {
	const q = `
SELECT id, email, password_hash, display_name, department_id, preferred_locale, is_active, created_at, updated_at
FROM users
WHERE email = $1 AND deleted_at IS NULL`
	u := &User{}
	err := r.pool.QueryRow(ctx, q, email).Scan(
		&u.ID, &u.Email, &u.PasswordHash, &u.DisplayName,
		&u.DepartmentID, &u.PreferredLocale, &u.IsActive,
		&u.CreatedAt, &u.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return u, nil
}

func (r *UserRepository) FindByID(ctx context.Context, id uuid.UUID) (*User, error) {
	const q = `
SELECT id, email, password_hash, display_name, department_id, preferred_locale, is_active, created_at, updated_at
FROM users
WHERE id = $1 AND deleted_at IS NULL`
	u := &User{}
	err := r.pool.QueryRow(ctx, q, id).Scan(
		&u.ID, &u.Email, &u.PasswordHash, &u.DisplayName,
		&u.DepartmentID, &u.PreferredLocale, &u.IsActive,
		&u.CreatedAt, &u.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return u, nil
}

// AssignDefaultRole assigns the 'employee' role to the user.
func (r *UserRepository) AssignDefaultRole(ctx context.Context, userID uuid.UUID) error {
	const q = `
INSERT INTO user_roles (user_id, role_id)
SELECT $1, id FROM roles WHERE name = 'employee'
ON CONFLICT DO NOTHING`
	_, err := r.pool.Exec(ctx, q, userID)
	return err
}

// FindRoles returns the role names assigned to the user.
func (r *UserRepository) FindRoles(ctx context.Context, userID uuid.UUID) ([]string, error) {
	const q = `
SELECT r.name
FROM user_roles ur
JOIN roles r ON r.id = ur.role_id
WHERE ur.user_id = $1`
	rows, err := r.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var roles []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		roles = append(roles, name)
	}
	return roles, rows.Err()
}
