import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Canvases Access API — Slack canvases.access parity.
 *
 * POST /api/docs/canvas/access — manage canvas sharing & permissions
 *   Actions:
 *     - set      — set access level for user/channel
 *     - delete   — revoke access for user/channel
 *     - lookup   — get access list for a canvas
 */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    action?: string
    canvas_id?: string
    user_ids?: string[]
    channel_ids?: string[]
    access_level?: 'read' | 'write' | 'admin'
  }

  const { action, canvas_id } = body
  if (!canvas_id) return NextResponse.json({ error: 'canvas_id_required' }, { status: 400 })

  // Ensure canvas_access table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.canvas_access (
      id          TEXT PRIMARY KEY,
      canvas_id   TEXT NOT NULL,
      grantee_type TEXT NOT NULL DEFAULT 'user',
      grantee_id  TEXT NOT NULL,
      access_level TEXT NOT NULL DEFAULT 'read',
      granted_by  TEXT,
      granted_at  BIGINT NOT NULL DEFAULT 0,
      UNIQUE(canvas_id, grantee_type, grantee_id)
    )
  `).catch(() => {})

  if (action === 'lookup') {
    const { rows } = await pool.query(
      `SELECT ca.*, u.username AS grantee_username
       FROM aaelink.canvas_access ca
       LEFT JOIN aaelink.users u ON u.id = ca.grantee_id AND ca.grantee_type = 'user'
       WHERE ca.canvas_id = $1
       ORDER BY ca.granted_at DESC`,
      [canvas_id]
    )
    return NextResponse.json({ access: rows })
  }

  if (action === 'set') {
    const level = body.access_level || 'read'
    const now = Date.now()
    const grants: Array<{ type: string; id: string }> = []

    for (const userId of (body.user_ids || [])) {
      grants.push({ type: 'user', id: userId })
    }
    for (const channelId of (body.channel_ids || [])) {
      grants.push({ type: 'channel', id: channelId })
    }

    for (const g of grants) {
      await pool.query(
        `INSERT INTO aaelink.canvas_access (id, canvas_id, grantee_type, grantee_id, access_level, granted_by, granted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (canvas_id, grantee_type, grantee_id) DO UPDATE SET access_level = $5, granted_by = $6, granted_at = $7`,
        [randomUUID(), canvas_id, g.type, g.id, level, uid, now]
      )
    }

    return NextResponse.json({ ok: true, grants_updated: grants.length })
  }

  if (action === 'delete') {
    const targets = [...(body.user_ids || []), ...(body.channel_ids || [])]
    if (targets.length > 0) {
      await pool.query(
        `DELETE FROM aaelink.canvas_access WHERE canvas_id = $1 AND grantee_id = ANY($2)`,
        [canvas_id, targets]
      )
    }
    return NextResponse.json({ ok: true, revoked: targets.length })
  }

  return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
}

export const POST = tracedRoute('POST', '/api/docs/canvas/access', _POST)
