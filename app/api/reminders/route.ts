import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'

/**
 * Reminders API
 *
 * POST — Create a reminder
 * GET  — List the user's pending reminders
 * DELETE — Cancel a reminder
 */

export async function POST(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()

  const { body, fire_at, message_id, channel_id } = (await req.json()) as {
    body?: string
    fire_at?: number
    message_id?: string
    channel_id?: string
  }
  if (!body?.trim() && !message_id) {
    return NextResponse.json({ error: 'body_or_message_required' }, { status: 400 })
  }
  if (!fire_at || fire_at <= Date.now()) {
    return NextResponse.json({ error: 'fire_at_must_be_future' }, { status: 400 })
  }

  const id = randomUUID()
  const now = Date.now()
  await pool.query(
    `INSERT INTO aaelink.reminders (id, user_id, body, message_id, channel_id, fire_at, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)`,
    [id, uid, (body || '').trim(), message_id || '', channel_id || '', fire_at, now]
  )

  return NextResponse.json({ id, fire_at })
}

export async function GET() {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()

  const { rows } = await pool.query(
    `SELECT id, body, message_id, channel_id, fire_at, status, created_at
     FROM aaelink.reminders
     WHERE user_id = $1 AND status = 'pending'
     ORDER BY fire_at ASC
     LIMIT 50`,
    [uid]
  )

  return NextResponse.json({ reminders: rows })
}

export async function DELETE(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()

  const { id } = (await req.json()) as { id?: string }
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  await pool.query(
    `UPDATE aaelink.reminders SET status = 'cancelled' WHERE id = $1 AND user_id = $2`,
    [id, uid]
  )

  return NextResponse.json({ ok: true })
}
