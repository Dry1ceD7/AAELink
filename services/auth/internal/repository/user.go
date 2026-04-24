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
	AvatarURL       *string
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
RETURNING id, email, password_hash, display_name, department_id, avatar_url, preferred_locale, is_active, created_at, updated_at`
	u := &User{}
	err := r.pool.QueryRow(ctx, q, email, passwordHash, displayName, locale, departmentID).Scan(
		&u.ID, &u.Email, &u.PasswordHash, &u.DisplayName,
		&u.DepartmentID, &u.AvatarURL, &u.PreferredLocale, &u.IsActive,
		&u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return u, nil
}

func (r *UserRepository) FindByEmail(ctx context.Context, email string) (*User, error) {
	const q = `
SELECT id, email, password_hash, display_name, department_id, avatar_url, preferred_locale, is_active, created_at, updated_at
FROM users
WHERE email = $1 AND deleted_at IS NULL`
	u := &User{}
	err := r.pool.QueryRow(ctx, q, email).Scan(
		&u.ID, &u.Email, &u.PasswordHash, &u.DisplayName,
		&u.DepartmentID, &u.AvatarURL, &u.PreferredLocale, &u.IsActive,
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
SELECT id, email, password_hash, display_name, department_id, avatar_url, preferred_locale, is_active, created_at, updated_at
FROM users
WHERE id = $1 AND deleted_at IS NULL`
	u := &User{}
	err := r.pool.QueryRow(ctx, q, id).Scan(
		&u.ID, &u.Email, &u.PasswordHash, &u.DisplayName,
		&u.DepartmentID, &u.AvatarURL, &u.PreferredLocale, &u.IsActive,
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

// UserWithRoles is a user joined with their role names.
type UserWithRoles struct {
	User
	Roles []string
}

// ListAll returns all non-deleted users with their roles, newest first.
func (r *UserRepository) ListAll(ctx context.Context, limit, offset int) ([]UserWithRoles, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	const q = `
SELECT u.id, u.email, u.password_hash, u.display_name, u.department_id, u.avatar_url,
       u.preferred_locale, u.is_active, u.created_at, u.updated_at,
       COALESCE(ARRAY_AGG(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
FROM users u
LEFT JOIN user_roles ur ON ur.user_id = u.id
LEFT JOIN roles r ON r.id = ur.role_id
WHERE u.deleted_at IS NULL
GROUP BY u.id
ORDER BY u.created_at DESC
LIMIT $1 OFFSET $2`
	rows, err := r.pool.Query(ctx, q, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]UserWithRoles, 0, 32)
	for rows.Next() {
		var u UserWithRoles
		if err := rows.Scan(
			&u.ID, &u.Email, &u.PasswordHash, &u.DisplayName,
			&u.DepartmentID, &u.AvatarURL, &u.PreferredLocale, &u.IsActive,
			&u.CreatedAt, &u.UpdatedAt, &u.Roles,
		); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// AssignRoleByName grants a role (by name) to a user; idempotent.
func (r *UserRepository) AssignRoleByName(ctx context.Context, userID uuid.UUID, roleName string) error {
	const q = `
INSERT INTO user_roles (user_id, role_id)
SELECT $1, id FROM roles WHERE name = $2
ON CONFLICT DO NOTHING`
	_, err := r.pool.Exec(ctx, q, userID, roleName)
	return err
}

// ReplaceRoles replaces the user's role assignments with the provided role names.
func (r *UserRepository) ReplaceRoles(ctx context.Context, userID uuid.UUID, roleNames []string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `DELETE FROM user_roles WHERE user_id = $1`, userID); err != nil {
		return err
	}
	for _, name := range roleNames {
		if name == "" {
			continue
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = $2`,
			userID, name,
		); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// SetActive toggles the user's active flag.
func (r *UserRepository) SetActive(ctx context.Context, userID uuid.UUID, active bool) error {
	const q = `UPDATE users SET is_active = $2, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL`
	ct, err := r.pool.Exec(ctx, q, userID, active)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// UpdateProfileParams carries optional fields for profile patching.
type UpdateProfileParams struct {
	Email           *string
	DisplayName     *string
	PreferredLocale *string
	DepartmentID    *uuid.UUID
	ClearDepartment bool
	AvatarURL       *string
	ClearAvatar     bool
}

// UpdateProfile patches mutable user attributes. Nil pointers are ignored.
func (r *UserRepository) UpdateProfile(ctx context.Context, userID uuid.UUID, p UpdateProfileParams) error {
	const q = `
UPDATE users SET
  email            = COALESCE($2, email),
  display_name     = COALESCE($3, display_name),
  preferred_locale = COALESCE($4, preferred_locale),
  department_id    = CASE WHEN $6::boolean THEN NULL ELSE COALESCE($5, department_id) END,
  avatar_url       = CASE WHEN $8::boolean THEN NULL ELSE COALESCE($7, avatar_url) END,
  updated_at       = NOW()
WHERE id = $1 AND deleted_at IS NULL`
	ct, err := r.pool.Exec(ctx, q,
		userID, p.Email, p.DisplayName, p.PreferredLocale,
		p.DepartmentID, p.ClearDepartment,
		p.AvatarURL, p.ClearAvatar,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// UpdatePasswordHash replaces the user's password hash.
func (r *UserRepository) UpdatePasswordHash(ctx context.Context, userID uuid.UUID, hash string) error {
	const q = `UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL`
	ct, err := r.pool.Exec(ctx, q, userID, hash)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// SoftDelete marks the user as deleted and disables the account.
func (r *UserRepository) SoftDelete(ctx context.Context, userID uuid.UUID) error {
	const q = `UPDATE users SET deleted_at = NOW(), is_active = false, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL`
	ct, err := r.pool.Exec(ctx, q, userID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
