import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { verifyCsrf } from '@/lib/auth/csrf'

async function _DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrfErr = await verifyCsrf(req)
  if (csrfErr) return csrfErr
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

    // Domain audit — best-effort, must not fail the request (Hard Rule #5).
    try {
      await pool.query(
        `INSERT INTO aaelink.audit_log (id, workspace_id, actor_id, action, resource_id, metadata, created_at)
         VALUES ($1, $2, $3, 'incoming_webhook.delete', $4, $5, $6)`,
        [randomUUID(), hook.workspace_id, userId, id, JSON.stringify({ created_by: hook.created_by }), Date.now()]
      )
    } catch { /* audit log is best-effort */ }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'webhook_delete_failed' }, { status: 503 })
  }
}

// ── Traced exports ──────────────────────────────────────────────────
export const DELETE = tracedRoute('DELETE', '/api/integrations/webhooks/:id', _DELETE)
