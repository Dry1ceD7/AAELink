import type { Pool } from 'pg'

/** IT members (department code `it`) and platform `super_admin` can see and manage all tickets in a workspace. */
export async function userIsItForWorkspace(pool: Pool, uid: string, workspaceId: string): Promise<boolean> {
  const { rows: pr } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`,
    [uid]
  )
  if (pr[0]?.platform_role === 'super_admin') return true
  const { rows } = await pool.query(
    `SELECT 1
     FROM aaelink.workspace_members m
     INNER JOIN aaelink.departments d ON d.id = m.department_id
     WHERE m.user_id = $1 AND m.workspace_id = $2 AND d.code = 'it'
     LIMIT 1`,
    [uid, workspaceId]
  )
  return Boolean(rows[0])
}

export async function getMemberDepartmentId(
  pool: Pool,
  uid: string,
  workspaceId: string
): Promise<string | null> {
  const { rows } = await pool.query<{ department_id: string | null }>(
    `SELECT department_id FROM aaelink.workspace_members WHERE user_id = $1 AND workspace_id = $2`,
    [uid, workspaceId]
  )
  return rows[0]?.department_id ?? null
}

export async function canViewTicket(
  pool: Pool,
  uid: string,
  ticket: { workspace_id: string | null; department_id: string | null; created_by: string | null }
): Promise<boolean> {
  if (!ticket.workspace_id) return false
  const member = await pool.query(
    `SELECT 1 FROM aaelink.workspace_members WHERE user_id = $1 AND workspace_id = $2`,
    [uid, ticket.workspace_id]
  )
  if (!member.rows[0]) return false
  if (ticket.created_by && ticket.created_by === uid) return true
  if (await userIsItForWorkspace(pool, uid, ticket.workspace_id)) return true
  const dept = await getMemberDepartmentId(pool, uid, ticket.workspace_id)
  if (ticket.department_id && dept && ticket.department_id === dept) return true
  return false
}
