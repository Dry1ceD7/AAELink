import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * GET /api/saved — list saved/bookmarked messages for the current user.
 *
 * Query params:
 *  - q (string): search body text (ILIKE)
 *  - limit (number): max results (default 50, max 100)
 *  - offset (number): pagination offset
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('q')?.trim() || ''
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit')) || 50, 1), 100)
  const offset = Math.max(Number(req.nextUrl.searchParams.get('offset')) || 0, 0)

  // Count total
  let countQuery = `SELECT COUNT(*)::text AS cnt FROM aaelink.saved_messages s
    JOIN aaelink.messages m ON m.id = s.message_id
    WHERE s.user_id = $1`
  const countParams: (string | number)[] = [uid]

  if (q) {
    countParams.push(`%${q}%`)
    countQuery += ` AND m.body ILIKE $${countParams.length}`
  }

  const { rows: cntRows } = await pool.query<{ cnt: string }>(countQuery, countParams)
  const total = Number(cntRows[0]?.cnt || 0)

  // Fetch page
  let query = `SELECT s.message_id, s.channel_id, s.created_at AS saved_at,
            m.body, m.created_at AS message_created_at, m.user_id AS author_id,
            m.root_id,
            c.display_name AS channel_name, c.name AS channel_slug, c.type AS channel_type,
            u.username AS author_username,
            u.first_name AS author_first_name,
            u.last_name AS author_last_name,
            u.avatar_url AS author_avatar_url
     FROM aaelink.saved_messages s
     JOIN aaelink.messages m ON m.id = s.message_id
     JOIN aaelink.channels c ON c.id = s.channel_id
     LEFT JOIN aaelink.users u ON u.id = m.user_id
     WHERE s.user_id = $1`
  const params: (string | number)[] = [uid]

  if (q) {
    params.push(`%${q}%`)
    query += ` AND m.body ILIKE $${params.length}`
  }

  params.push(limit, offset)
  query += ` ORDER BY s.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`

  const { rows } = await pool.query(query, params)

  return NextResponse.json({
    items: rows,
    total,
    limit,
    offset,
    has_more: offset + rows.length < total
  })
}

/** POST /api/saved — bookmark a message.  Body: { message_id, channel_id } */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { message_id?: string; channel_id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  const { message_id, channel_id } = body
  if (!message_id || !channel_id) {
    return NextResponse.json({ error: 'message_id_and_channel_id_required' }, { status: 400 })
  }

  await pool.query(
    `INSERT INTO aaelink.saved_messages (user_id, message_id, channel_id, created_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, message_id) DO NOTHING`,
    [uid, message_id, channel_id, Date.now()]
  )

  // Get the saved count for user feedback
  const { rows: cntRows } = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM aaelink.saved_messages WHERE user_id = $1`, [uid]
  )

  return NextResponse.json({ ok: true, saved_count: Number(cntRows[0]?.cnt || 0) })
}

/** DELETE /api/saved — remove a bookmark.  Body: { message_id } */
async function _DELETE(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { message_id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  if (!body.message_id) {
    return NextResponse.json({ error: 'message_id_required' }, { status: 400 })
  }

  await pool.query(
    `DELETE FROM aaelink.saved_messages WHERE user_id = $1 AND message_id = $2`,
    [uid, body.message_id]
  )

  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/saved', _GET)
export const POST   = tracedRoute('POST', '/api/saved', _POST)
export const DELETE = tracedRoute('DELETE', '/api/saved', _DELETE)
