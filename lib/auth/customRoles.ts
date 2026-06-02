import { randomUUID } from 'crypto'
import type { Pool } from 'pg'

/**
 * Custom admin role management.
 *
 * Manages workspace-scoped roles with granular permissions,
 * role assignments (optionally scoped to channel/team), and
 * aggregated permission resolution for a given user.
 */

export type Permission = string // e.g. 'channels:manage', 'users:invite', 'audit:read'

export interface Role {
  id: string
  workspace_id: string
  name: string
  description: string
  permissions: Permission[]
  is_system: boolean
  created_at: number
}

export interface RoleAssignment {
  id: string
  role_id: string
  user_id: string
  workspace_id: string
  scope: string       // 'workspace' | 'channel' | 'team'
  scope_id: string    // '' for workspace-wide
  assigned_by: string
  assigned_at: number
}

const SYSTEM_ROLES = new Set(['owner', 'admin', 'member', 'guest'])

export async function createRole(
  pool: Pool, workspaceId: string, name: string, description: string, permissions: Permission[]
): Promise<Role> {
  const id = randomUUID()
  const now = Date.now()
  await pool.query(
    `INSERT INTO aaelink.custom_roles (id, workspace_id, name, description, permissions, is_system, created_at)
     VALUES ($1, $2, $3, $4, $5, false, $6)`,
    [id, workspaceId, name, description, JSON.stringify(permissions), now]
  )
  return { id, workspace_id: workspaceId, name, description, permissions, is_system: false, created_at: now }
}

export async function updateRole(
  pool: Pool, roleId: string, updates: { name?: string; description?: string; permissions?: Permission[] }
): Promise<void> {
  const sets: string[] = []
  const vals: unknown[] = []
  let idx = 1
  if (updates.name !== undefined)        { sets.push(`name = $${idx++}`);        vals.push(updates.name) }
  if (updates.description !== undefined) { sets.push(`description = $${idx++}`); vals.push(updates.description) }
  if (updates.permissions !== undefined) { sets.push(`permissions = $${idx++}`); vals.push(JSON.stringify(updates.permissions)) }
  if (sets.length === 0) return
  vals.push(roleId)
  await pool.query(`UPDATE aaelink.custom_roles SET ${sets.join(', ')} WHERE id = $${idx} AND is_system = false`, vals)
}

export async function deleteRole(pool: Pool, roleId: string): Promise<boolean> {
  const { rows } = await pool.query<{ name: string; is_system: boolean }>(
    `SELECT name, is_system FROM aaelink.custom_roles WHERE id = $1`, [roleId]
  )
  if (!rows[0]) return false
  if (rows[0].is_system || SYSTEM_ROLES.has(rows[0].name)) return false
  await pool.query(`DELETE FROM aaelink.role_assignments WHERE role_id = $1`, [roleId])
  await pool.query(`DELETE FROM aaelink.custom_roles WHERE id = $1`, [roleId])
  return true
}

export async function listRoles(pool: Pool, workspaceId: string): Promise<Role[]> {
  const { rows } = await pool.query(
    `SELECT * FROM aaelink.custom_roles WHERE workspace_id = $1 ORDER BY is_system DESC, name ASC`,
    [workspaceId]
  )
  return rows.map((r: Record<string, unknown>) => ({
    ...r,
    permissions: typeof r.permissions === 'string' ? JSON.parse(r.permissions as string) : r.permissions,
  })) as Role[]
}

export async function assignRole(
  pool: Pool, roleId: string, userId: string, workspaceId: string,
  scope: string, scopeId: string, assignedBy: string
): Promise<RoleAssignment> {
  const id = randomUUID()
  const now = Date.now()
  await pool.query(
    `INSERT INTO aaelink.role_assignments (id, role_id, user_id, workspace_id, scope, scope_id, assigned_by, assigned_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT DO NOTHING`,
    [id, roleId, userId, workspaceId, scope, scopeId || '', assignedBy, now]
  )
  return { id, role_id: roleId, user_id: userId, workspace_id: workspaceId, scope, scope_id: scopeId || '', assigned_by: assignedBy, assigned_at: now }
}

export async function removeAssignment(pool: Pool, assignmentId: string): Promise<void> {
  await pool.query(`DELETE FROM aaelink.role_assignments WHERE id = $1`, [assignmentId])
}

export async function listAssignments(
  pool: Pool, workspaceId: string, filters?: { userId?: string; roleId?: string }
): Promise<RoleAssignment[]> {
  let sql = `SELECT * FROM aaelink.role_assignments WHERE workspace_id = $1`
  const params: unknown[] = [workspaceId]
  let idx = 2
  if (filters?.userId)  { sql += ` AND user_id = $${idx++}`;  params.push(filters.userId) }
  if (filters?.roleId)  { sql += ` AND role_id = $${idx++}`;  params.push(filters.roleId) }
  sql += ` ORDER BY assigned_at DESC`
  const { rows } = await pool.query(sql, params)
  return rows as RoleAssignment[]
}

export async function getUserPermissions(pool: Pool, userId: string, workspaceId: string): Promise<Permission[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT r.permissions
     FROM aaelink.role_assignments a
     JOIN aaelink.custom_roles r ON r.id = a.role_id
     WHERE a.user_id = $1 AND a.workspace_id = $2`,
    [userId, workspaceId]
  )
  const allPerms = new Set<Permission>()
  for (const row of rows) {
    const perms = typeof (row as Record<string, unknown>).permissions === 'string'
      ? JSON.parse((row as Record<string, unknown>).permissions as string)
      : (row as Record<string, unknown>).permissions
    if (Array.isArray(perms)) perms.forEach((p: Permission) => allPerms.add(p))
  }
  return [...allPerms]
}
