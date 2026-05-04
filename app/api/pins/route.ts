import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'

/** GET /api/pins?channel_id=... — list pinned messages for a channel. */
export async function GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const channelId = req.nextUrl.searchParams.get('channel_id') || ''
  if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })

  const { rows } = await pool.query(
    `SELECT p.message_id, p.pinned_by, p.pinned_at,
            m.body, m.user_id AS author_id, m.created_at AS message_created_at
     FROM aaelink.pinned_messages p
     JOIN aaelink.messages m ON m.id = p.message_id
     WHERE p.channel_id = $1
     ORDER BY p.pinned_at DESC
     LIMIT 50`,
    [channelId]
  )

  return NextResponse.json({ pins: rows })
}

/** POST /api/pins — pin a message.  Body: { channel_id, message_id } */
export async function POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { channel_id?: string; message_id?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }) }

  const { channel_id, message_id } = body
  if (!channel_id || !message_id) return NextResponse.json({ error: 'channel_id_and_message_id_required' }, { status: 400 })

  await pool.query(
    `INSERT INTO aaelink.pinned_messages (channel_id, message_id, pinned_by, pinned_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (channel_id, message_id) DO NOTHING`,
    [channel_id, message_id, uid, Date.now()]
  )

  return NextResponse.json({ ok: true })
}

/** DELETE /api/pins — unpin a message.  Body: { channel_id, message_id } */
export async function DELETE(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { channel_id?: string; message_id?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }) }

  if (!body.channel_id || !body.message_id) return NextResponse.json({ error: 'channel_id_and_message_id_required' }, { status: 400 })

  await pool.query(
    `DELETE FROM aaelink.pinned_messages WHERE channel_id = $1 AND message_id = $2`,
    [body.channel_id, body.message_id]
  )

  return NextResponse.json({ ok: true })
}
