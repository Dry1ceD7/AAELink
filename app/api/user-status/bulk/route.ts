import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * GET /api/user-status/bulk?workspace_id=...
 *
 * Returns the explicit statuses (especially DND) for all users in a workspace.
 * Used by the presence listener to merge manual status overrides with
 * timestamp-based presence computation.
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const wsId = req.nextUrl.searchParams.get('workspace_id')?.trim() || ''
  if (!wsId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })

  // Only return statuses for users who are members of the requested workspace
  const { rows } = await pool.query<{ user_id: string; status: string }>(
    `SELECT us.user_id, us.status
     FROM aaelink.user_status us
     JOIN aaelink.workspace_members wm ON wm.user_id = us.user_id
     WHERE wm.workspace_id = $1
       AND us.status IN ('dnd', 'away', 'offline')`,
    [wsId]
  )

  const statuses: Record<string, string> = {}
  for (const r of rows) {
    statuses[r.user_id] = r.status
  }

  return NextResponse.json({ statuses })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/user-status/bulk', _GET)
