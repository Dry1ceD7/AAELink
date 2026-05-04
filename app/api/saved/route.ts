import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'

/** GET /api/saved — list saved/bookmarked messages for the current user. */
export async function GET() {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows } = await pool.query(
    `SELECT s.message_id, s.channel_id, s.created_at AS saved_at,
            m.body, m.created_at AS message_created_at, m.user_id AS author_id,
            c.display_name AS channel_name
     FROM aaelink.saved_messages s
     JOIN aaelink.messages m ON m.id = s.message_id
     JOIN aaelink.channels c ON c.id = s.channel_id
     WHERE s.user_id = $1
     ORDER BY s.created_at DESC
     LIMIT 100`,
    [uid]
  )

  return NextResponse.json({ items: rows })
}

/** POST /api/saved — bookmark a message.  Body: { message_id, channel_id } */
export async function POST(req: NextRequest) {
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

  return NextResponse.json({ ok: true })
}

/** DELETE /api/saved — remove a bookmark.  Body: { message_id } */
export async function DELETE(req: NextRequest) {
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
