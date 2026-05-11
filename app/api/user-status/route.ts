import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

const VALID_STATUSES = ['online', 'away', 'dnd', 'offline']

/** GET /api/user-status — get the caller's presence status. */
async function _GET() {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows } = await pool.query(
    `SELECT status, custom_text FROM aaelink.user_status WHERE user_id = $1`,
    [uid]
  )
  const row = rows[0] as { status: string; custom_text: string } | undefined

  return NextResponse.json({
    status: row?.status || 'online',
    custom_text: row?.custom_text || ''
  })
}

/** PATCH /api/user-status — update status.  Body: { status?, custom_text? } */
async function _PATCH(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { status?: string; custom_text?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const s = body.status ? String(body.status).toLowerCase() : undefined
  if (s && !VALID_STATUSES.includes(s)) {
    return NextResponse.json({ error: 'invalid_status' }, { status: 400 })
  }

  const ct = typeof body.custom_text === 'string' ? body.custom_text.slice(0, 200) : undefined
  const now = Date.now()

  await pool.query(
    `INSERT INTO aaelink.user_status (user_id, status, custom_text, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET
       status = COALESCE($2, aaelink.user_status.status),
       custom_text = COALESCE($3, aaelink.user_status.custom_text),
       updated_at = $4`,
    [uid, s || 'online', ct ?? '', now]
  )

  return NextResponse.json({ status: s || 'online', custom_text: ct ?? '' })
}

/**
 * PUT /api/user-status — set custom status with optional expiry (Slack-style).
 * Body: { status_text, status_emoji, expires_at? }
 * expires_at is a Unix epoch ms timestamp; 0 or omitted = no expiry.
 */
async function _PUT(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { status_text?: string; status_emoji?: string; expires_at?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const statusText = typeof body.status_text === 'string' ? body.status_text.slice(0, 200) : ''
  const statusEmoji = typeof body.status_emoji === 'string' ? body.status_emoji.slice(0, 32) : ''
  const expiresAt = typeof body.expires_at === 'number' && body.expires_at > 0 ? body.expires_at : 0

  // Write to users table (status_text and status_emoji are user profile fields)
  await pool.query(
    `UPDATE aaelink.users SET status_text = $1, status_emoji = $2 WHERE id = $3`,
    [statusText, statusEmoji, uid]
  )

  // Also upsert the status row with expiry for auto-clear
  const now = Date.now()
  await pool.query(
    `INSERT INTO aaelink.user_status (user_id, status, custom_text, updated_at, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET
       custom_text = $3,
       updated_at = $4,
       expires_at = $5`,
    [uid, statusEmoji === '🔕' ? 'dnd' : 'online', statusText, now, expiresAt]
  )

  return NextResponse.json({ status_text: statusText, status_emoji: statusEmoji, expires_at: expiresAt })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET   = tracedRoute('GET',   '/api/user-status', _GET)
export const PATCH = tracedRoute('PATCH', '/api/user-status', _PATCH)
export const PUT   = tracedRoute('PUT',   '/api/user-status', _PUT)

