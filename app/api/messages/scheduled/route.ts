// keep: slack-compat surface (intentionally addressable, may be invoked by Slack-shaped clients)
import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Scheduled Messages API (Slack "Schedule send").
 *
 * GET    /api/messages/scheduled?workspace_id=...  — list user's scheduled messages
 * POST   /api/messages/scheduled                    — schedule a message for future delivery
 * DELETE /api/messages/scheduled { scheduled_id }   — cancel a scheduled message
 *
 * The actual delivery is handled by a background job that polls
 * `aaelink.scheduled_messages` for pending items where `send_at <= now()`.
 */

/** GET — list pending scheduled messages for the user */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const workspaceId = req.nextUrl.searchParams.get('workspace_id')?.trim() || ''
  const showAll = req.nextUrl.searchParams.get('include_sent') === 'true'

  let sql = `
    SELECT sm.id, sm.channel_id, sm.body, sm.send_at, sm.status,
           sm.created_at, sm.sent_at,
           c.name AS channel_name, c.display_name AS channel_display
    FROM aaelink.scheduled_messages sm
    JOIN aaelink.channels c ON c.id = sm.channel_id
    WHERE sm.user_id = $1
  `
  const params: (string | number)[] = [uid]
  let idx = 2

  if (workspaceId) {
    sql += ` AND c.workspace_id = $${idx}`
    params.push(workspaceId)
    idx++
  }

  if (!showAll) {
    sql += ` AND sm.status = 'pending'`
  }

  sql += ` ORDER BY sm.send_at ASC LIMIT 100`

  const { rows } = await pool.query(sql, params)

  return NextResponse.json({ scheduled: rows })
}

/** POST — schedule a message for future delivery */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    channel_id?: string
    body?: string
    send_at?: number // epoch ms
    root_id?: string
  }

  const channelId = String(body.channel_id || '').trim()
  const messageBody = String(body.body || '').trim()
  const sendAt = Number(body.send_at || 0)
  const rootId = String(body.root_id || '').trim()

  if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })
  if (!messageBody) return NextResponse.json({ error: 'body_required' }, { status: 400 })
  if (!sendAt || sendAt <= Date.now()) {
    return NextResponse.json({ error: 'send_at_must_be_future' }, { status: 400 })
  }

  // Max 30 days in the future
  const maxFuture = Date.now() + 30 * 24 * 60 * 60 * 1000
  if (sendAt > maxFuture) {
    return NextResponse.json({ error: 'send_at_too_far_future' }, { status: 400 })
  }

  // Verify channel membership
  const { rows: ch } = await pool.query<{ type: string }>(
    `SELECT type FROM aaelink.channels WHERE id = $1`,
    [channelId]
  )
  if (!ch[0]) return NextResponse.json({ error: 'channel_not_found' }, { status: 404 })

  if (ch[0].type === 'P') {
    const { rows: mem } = await pool.query(
      `SELECT 1 FROM aaelink.channel_members WHERE channel_id = $1 AND user_id = $2`,
      [channelId, uid]
    )
    if (!mem[0]) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const id = randomUUID()
  const now = Date.now()

  await pool.query(
    `INSERT INTO aaelink.scheduled_messages (id, user_id, channel_id, root_id, body, send_at, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)`,
    [id, uid, channelId, rootId, messageBody, sendAt, now]
  )

  return NextResponse.json({
    scheduled: {
      id,
      channel_id: channelId,
      body: messageBody,
      send_at: sendAt,
      status: 'pending',
      created_at: now
    }
  })
}

/** DELETE — cancel a scheduled message */
async function _DELETE(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { scheduled_id?: string }
  const scheduledId = String(body.scheduled_id || '').trim()
  if (!scheduledId) return NextResponse.json({ error: 'scheduled_id_required' }, { status: 400 })

  // Only allow cancelling own pending messages
  const { rowCount } = await pool.query(
    `DELETE FROM aaelink.scheduled_messages WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
    [scheduledId, uid]
  )

  if (!rowCount) return NextResponse.json({ error: 'not_found_or_already_sent' }, { status: 404 })

  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/messages/scheduled', _GET)
export const POST   = tracedRoute('POST', '/api/messages/scheduled', _POST)
export const DELETE = tracedRoute('DELETE', '/api/messages/scheduled', _DELETE)
