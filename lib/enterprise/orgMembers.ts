import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'

/**
 * Organization membership management.
 *
 * Manages the `org_members` join table that links users to
 * an Enterprise Grid organization with role-based access.
 */

export type OrgRole = 'org_owner' | 'org_admin' | 'member'

export interface OrgMember {
  org_id:    string
  user_id:   string
  role:      OrgRole
  joined_at: string
}

export async function addOrgMember(
  orgId: string,
  userId: string,
  role: OrgRole = 'member'
): Promise<OrgMember | null> {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return null
  const { rows } = await pool.query<OrgMember>(
    `INSERT INTO aaelink.org_members (org_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (org_id, user_id) DO UPDATE SET role = $3
     RETURNING *`,
    [orgId, userId, role]
  )
  return rows[0] ?? null
}

export async function removeOrgMember(orgId: string, userId: string): Promise<boolean> {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return false
  const res = await pool.query(
    `DELETE FROM aaelink.org_members WHERE org_id = $1 AND user_id = $2`,
    [orgId, userId]
  )
  return (res.rowCount ?? 0) > 0
}

export async function updateOrgMemberRole(
  orgId: string,
  userId: string,
  role: OrgRole
): Promise<OrgMember | null> {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return null
  const { rows } = await pool.query<OrgMember>(
    `UPDATE aaelink.org_members SET role = $3
     WHERE org_id = $1 AND user_id = $2
     RETURNING *`,
    [orgId, userId, role]
  )
  return rows[0] ?? null
}

export async function listOrgMembers(
  orgId: string,
  limit = 50,
  offset = 0
): Promise<OrgMember[]> {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return []
  const { rows } = await pool.query<OrgMember>(
    `SELECT * FROM aaelink.org_members
     WHERE org_id = $1
     ORDER BY joined_at
     LIMIT $2 OFFSET $3`,
    [orgId, limit, offset]
  )
  return rows
}

export async function isOrgAdmin(orgId: string, userId: string): Promise<boolean> {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return false
  const { rows } = await pool.query<{ role: string }>(
    `SELECT role FROM aaelink.org_members WHERE org_id = $1 AND user_id = $2`,
    [orgId, userId]
  )
  const role = rows[0]?.role
  return role === 'org_owner' || role === 'org_admin'
}
