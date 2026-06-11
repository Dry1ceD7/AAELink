// keep: slack-compat surface (intentionally addressable, may be invoked by Slack-shaped clients)
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { loadCanvas, canAdministerCanvas } from '@/lib/knowledge/canvasAccess'

/**
 * Canvases Access API — Slack canvases.access parity.
 *
 * POST /api/docs/canvas/access — manage canvas sharing & permissions
 *   Actions:
 *     - set      — set access level for user/channel
 *     - delete   — revoke access for user/channel
 *     - lookup   — get access list for a canvas
 *
 * Grants here are ENFORCED: lib/knowledge/canvasAccess reads this table when
 * resolving read/write access (they used to be inert). Only a user who can
 * administer the canvas (creator, platform admin, or admin-grant holder) may
 * set/revoke grants or read the grant list.
 */
async function _POST(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
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

  const canvas = await loadCanvas(pool, canvas_id)
  if (!canvas || canvas.deleted_at !== 0) {
    return NextResponse.json({ error: 'canvas_not_found' }, { status: 404 })
  }
  if (!(await canAdministerCanvas(pool, uid, canvas))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

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
    if (!['read', 'write', 'admin'].includes(level)) {
      return NextResponse.json({ error: 'invalid_access_level' }, { status: 400 })
    }
    const now = Date.now()
    const grants: Array<{ type: string; id: string }> = []

    for (const userId of body.user_ids || []) grants.push({ type: 'user', id: userId })
    for (const channelId of body.channel_ids || []) grants.push({ type: 'channel', id: channelId })

    for (const g of grants) {
      await pool.query(
        `INSERT INTO aaelink.canvas_access (id, canvas_id, grantee_type, grantee_id, access_level, granted_by, granted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (canvas_id, grantee_type, grantee_id) DO UPDATE SET access_level = $5, granted_by = $6, granted_at = $7`,
        [randomUUID(), canvas_id, g.type, g.id, level, uid, now]
      )
    }

    writeAuditLog({
      pool, actorId: uid, action: 'canvas.access_set', resourceKind: 'canvas', resourceId: canvas_id,
      ipAddress: extractIp(req), metadata: { level, grants: grants.length },
    })

    return NextResponse.json({ ok: true, grants_updated: grants.length })
  }

  if (action === 'delete') {
    // Revoke must be the inverse of 'set': type-scoped. Deleting purely by
    // grantee_id (no grantee_type) would over-delete if a user id and a channel
    // id ever share a value — revoking a user grant could silently drop an
    // unrelated channel grant on the same canvas. Match grantee_type explicitly.
    const userIds = body.user_ids || []
    const channelIds = body.channel_ids || []
    if (userIds.length > 0) {
      await pool.query(
        `DELETE FROM aaelink.canvas_access WHERE canvas_id = $1 AND grantee_type = 'user' AND grantee_id = ANY($2)`,
        [canvas_id, userIds]
      )
    }
    if (channelIds.length > 0) {
      await pool.query(
        `DELETE FROM aaelink.canvas_access WHERE canvas_id = $1 AND grantee_type = 'channel' AND grantee_id = ANY($2)`,
        [canvas_id, channelIds]
      )
    }
    const revoked = userIds.length + channelIds.length
    writeAuditLog({
      pool, actorId: uid, action: 'canvas.access_revoke', resourceKind: 'canvas', resourceId: canvas_id,
      ipAddress: extractIp(req), metadata: { revoked },
    })
    return NextResponse.json({ ok: true, revoked })
  }

  return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
}

export const POST = tracedRoute('POST', '/api/docs/canvas/access', _POST)
