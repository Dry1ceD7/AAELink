import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { isPlatformAdmin } from '@/lib/platformRole'
import { tracedRoute } from '@/lib/tracedRoute'

async function _DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params

  try {
    const { rows } = await pool.query<{ workspace_id: string; created_by: string }>(
      `SELECT workspace_id, created_by FROM aaelink.incoming_webhooks WHERE id = $1`,
      [id]
    )
    if (rows.length === 0) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    const hook = rows[0]
    let allowed = false

    // Workspace owner/admin can delete.
    const { rows: mRows } = await pool.query<{ role: string }>(
      `SELECT role FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2 LIMIT 1`,
      [hook.workspace_id, userId]
    )
    const wsRole = mRows[0]?.role || ''
    if (wsRole === 'owner' || wsRole === 'admin') {
      allowed = true
    }

    // Platform admins (super_admin / it_admin) can also delete.
    if (!allowed) {
      const { rows: uRows } = await pool.query<{ platform_role: string }>(
        `SELECT platform_role FROM aaelink.users WHERE id = $1`,
        [userId]
      )
      if (isPlatformAdmin(uRows[0]?.platform_role || '')) {
        allowed = true
      }
    }

    if (!allowed) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    await pool.query(`DELETE FROM aaelink.incoming_webhooks WHERE id = $1`, [id])
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'webhook_delete_failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ── Traced exports ──────────────────────────────────────────────────
export const DELETE = tracedRoute('DELETE', '/api/integrations/webhooks/:id', _DELETE)
