import { NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isWorkspaceMember } from '@/lib/workspace/workspaceAccess'
import { tracedRoute } from '@/lib/api/tracedRoute'

async function _DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()
  const { id: workspaceId } = await ctx.params
  const { rows } = await pool.query<{ is_system: boolean; role: string }>(
    `SELECT w.is_system, m.role
     FROM aaelink.workspaces w
     INNER JOIN aaelink.workspace_members m ON m.workspace_id = w.id AND m.user_id = $1
     WHERE w.id = $2`,
    [uid, workspaceId]
  )
  const row = rows[0]
  if (!row) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (row.is_system) {
    return NextResponse.json({ error: 'system_workspace_cannot_delete' }, { status: 403 })
  }
  if (row.role !== 'owner') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  await pool.query(`DELETE FROM aaelink.workspaces WHERE id = $1`, [workspaceId])
  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const DELETE = tracedRoute('DELETE', '/api/workspaces/:id', _DELETE)
