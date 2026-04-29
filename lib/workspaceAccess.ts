import type { Pool } from 'pg'

export async function isWorkspaceMember(
  pool: Pool,
  userId: string,
  workspaceId: string
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM aaelink.workspace_members WHERE user_id = $1 AND workspace_id = $2 LIMIT 1`,
    [userId, workspaceId]
  )
  return Boolean(rows[0])
}
