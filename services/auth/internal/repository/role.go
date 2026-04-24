package repository

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Role mirrors a row of the roles table. SystemRoles are the seeded
// defaults (it_admin, it_employee, employee) that can never be deleted —
// only their permission grants may be modified.
type Role struct {
	ID          uuid.UUID
	Name        string
	DisplayName map[string]string
	Description string
	IsSystem    bool
	CreatedAt   time.Time
	Permissions []Permission
}

type Permission struct {
	ID          uuid.UUID
	Resource    string
	Action      string
	Description string
}

type RoleRepository struct {
	pool *pgxpool.Pool
}

func NewRoleRepository(pool *pgxpool.Pool) *RoleRepository {
	return &RoleRepository{pool: pool}
}

// ListAll returns every role with its permission set.
func (r *RoleRepository) ListAll(ctx context.Context) ([]Role, error) {
	const q = `
SELECT id, name, display_name, COALESCE(description, ''), is_system, created_at
FROM roles
ORDER BY is_system DESC, name ASC`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Role, 0, 8)
	for rows.Next() {
		var role Role
		var nameJSON []byte
		if err := rows.Scan(&role.ID, &role.Name, &nameJSON, &role.Description, &role.IsSystem, &role.CreatedAt); err != nil {
			return nil, err
		}
		role.DisplayName = map[string]string{}
		_ = json.Unmarshal(nameJSON, &role.DisplayName)
		out = append(out, role)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for i := range out {
		perms, err := r.permissionsForRole(ctx, out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].Permissions = perms
	}
	return out, nil
}

func (r *RoleRepository) FindByID(ctx context.Context, id uuid.UUID) (*Role, error) {
	const q = `
SELECT id, name, display_name, COALESCE(description, ''), is_system, created_at
FROM roles WHERE id = $1`
	var role Role
	var nameJSON []byte
	err := r.pool.QueryRow(ctx, q, id).Scan(
		&role.ID, &role.Name, &nameJSON, &role.Description, &role.IsSystem, &role.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	role.DisplayName = map[string]string{}
	_ = json.Unmarshal(nameJSON, &role.DisplayName)
	role.Permissions, err = r.permissionsForRole(ctx, role.ID)
	if err != nil {
		return nil, err
	}
	return &role, nil
}

func (r *RoleRepository) permissionsForRole(ctx context.Context, roleID uuid.UUID) ([]Permission, error) {
	const q = `
SELECT p.id, p.resource, p.action, COALESCE(p.description, '')
FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE rp.role_id = $1
ORDER BY p.resource, p.action`
	rows, err := r.pool.Query(ctx, q, roleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Permission, 0)
	for rows.Next() {
		var p Permission
		if err := rows.Scan(&p.ID, &p.Resource, &p.Action, &p.Description); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

type CreateRoleParams struct {
	Name           string
	DisplayName    map[string]string
	Description    string
	PermissionIDs  []uuid.UUID
}

// Create inserts a new (non-system) role and grants it the supplied
// permissions atomically.
func (r *RoleRepository) Create(ctx context.Context, p CreateRoleParams) (*Role, error) {
	name := strings.ToLower(strings.TrimSpace(p.Name))
	if name == "" {
		return nil, errors.New("role name is empty")
	}
	displayJSON, err := json.Marshal(p.DisplayName)
	if err != nil {
		return nil, err
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	const q = `
INSERT INTO roles (name, display_name, description, is_system)
VALUES ($1, $2::jsonb, NULLIF($3, ''), false)
RETURNING id, created_at`
	var id uuid.UUID
	var createdAt time.Time
	if err := tx.QueryRow(ctx, q, name, displayJSON, p.Description).Scan(&id, &createdAt); err != nil {
		return nil, err
	}

	for _, pid := range p.PermissionIDs {
		if _, err := tx.Exec(ctx,
			`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
			id, pid,
		); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	out := &Role{
		ID:          id,
		Name:        name,
		DisplayName: p.DisplayName,
		Description: p.Description,
		IsSystem:    false,
		CreatedAt:   createdAt,
	}
	out.Permissions, _ = r.permissionsForRole(ctx, id)
	return out, nil
}

// UpdatePermissions replaces the permission grants for a role.
// System roles can have their permission set adjusted, but their name and
// system flag are immutable.
func (r *RoleRepository) UpdatePermissions(ctx context.Context, roleID uuid.UUID, permissionIDs []uuid.UUID) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `DELETE FROM role_permissions WHERE role_id = $1`, roleID); err != nil {
		return err
	}
	for _, pid := range permissionIDs {
		if _, err := tx.Exec(ctx,
			`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
			roleID, pid,
		); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// UpdateMeta lets administrators rename or re-describe a custom role.
// System roles cannot be renamed.
type UpdateRoleMeta struct {
	DisplayName map[string]string
	Description *string
}

func (r *RoleRepository) UpdateMeta(ctx context.Context, roleID uuid.UUID, meta UpdateRoleMeta) error {
	var displayJSON any
	if meta.DisplayName != nil {
		b, err := json.Marshal(meta.DisplayName)
		if err != nil {
			return err
		}
		displayJSON = b
	}
	const q = `
UPDATE roles SET
  display_name = COALESCE($2::jsonb, display_name),
  description  = COALESCE($3, description)
WHERE id = $1`
	ct, err := r.pool.Exec(ctx, q, roleID, displayJSON, meta.Description)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Delete removes a non-system role. System roles are protected.
func (r *RoleRepository) Delete(ctx context.Context, roleID uuid.UUID) error {
	const q = `DELETE FROM roles WHERE id = $1 AND is_system = false`
	ct, err := r.pool.Exec(ctx, q, roleID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *RoleRepository) ListPermissions(ctx context.Context) ([]Permission, error) {
	const q = `
SELECT id, resource, action, COALESCE(description, '')
FROM permissions
ORDER BY resource, action`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Permission, 0, 16)
	for rows.Next() {
		var p Permission
		if err := rows.Scan(&p.ID, &p.Resource, &p.Action, &p.Description); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
