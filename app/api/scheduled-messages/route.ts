import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { randomUUID } from 'crypto'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Scheduled Messages API — "Send Later" (Slack-style).
 *
 * POST /api/scheduled-messages               → schedule a message for future delivery
 * GET  /api/scheduled-messages               → list pending scheduled messages for the caller
 * DELETE /api/scheduled-messages?id=...      → cancel a scheduled message
 */

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { channel_id?: string; body?: string; send_at?: number; root_id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const channelId = String(body.channel_id || '').trim()
  const messageBody = String(body.body || '').trim()
  const sendAt = Number(body.send_at)
  const rootId = String(body.root_id || '').trim()

  if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })
  if (!messageBody) return NextResponse.json({ error: 'body_required' }, { status: 400 })
  if (!Number.isFinite(sendAt) || sendAt <= Date.now()) {
    return NextResponse.json({ error: 'send_at_must_be_future' }, { status: 400 })
  }

  const id = randomUUID()
  const now = Date.now()

  await pool.query(
    `INSERT INTO aaelink.scheduled_messages (id, channel_id, user_id, body, root_id, send_at, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)`,
    [id, channelId, uid, messageBody, rootId, sendAt, now]
  )

  return NextResponse.json({
    id,
    channel_id: channelId,
    body: messageBody,
    send_at: sendAt,
    status: 'pending',
    created_at: now
  }, { status: 201 })
}

async function _GET() {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows } = await pool.query<{
    id: string; channel_id: string; body: string; root_id: string
    send_at: string; status: string; created_at: string
  }>(
    `SELECT id, channel_id, body, root_id, send_at, status, created_at
     FROM aaelink.scheduled_messages
     WHERE user_id = $1 AND status = 'pending'
     ORDER BY send_at ASC`,
    [uid]
  )

  return NextResponse.json({
    messages: rows.map(r => ({
      ...r,
      send_at: Number(r.send_at),
      created_at: Number(r.created_at)
    }))
  })
}

async function _DELETE(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')?.trim() || ''
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  const result = await pool.query(
    `UPDATE aaelink.scheduled_messages SET status = 'cancelled'
     WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
    [id, uid]
  )

  if ((result as { rowCount?: number }).rowCount === 0) {
    return NextResponse.json({ error: 'not_found_or_already_sent' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/scheduled-messages', _GET)
export const POST   = tracedRoute('POST', '/api/scheduled-messages', _POST)
export const DELETE = tracedRoute('DELETE', '/api/scheduled-messages', _DELETE)
