import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * POST /api/channels/join — join a public channel by name.
 *
 * Body: { channel_name: string }
 * Only works for public channels (type = 'O').
 */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { channel_name?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const name = String(body.channel_name || '').trim().toLowerCase()
  if (!name) return NextResponse.json({ error: 'channel_name_required' }, { status: 400 })

  // Find the channel
  const { rows: chRows } = await pool.query<{ id: string; type: string }>(
    `SELECT id, type FROM aaelink.channels WHERE LOWER(name) = $1 LIMIT 1`,
    [name]
  )

  if (chRows.length === 0) {
    return NextResponse.json({ error: 'channel_not_found' }, { status: 404 })
  }

  const ch = chRows[0]
  if (ch.type !== 'O') {
    return NextResponse.json({ error: 'cannot_join_private' }, { status: 403 })
  }

  // Add the user as a member (idempotent)
  await pool.query(
    `INSERT INTO aaelink.channel_members (channel_id, user_id, created_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (channel_id, user_id) DO NOTHING`,
    [ch.id, uid, Date.now()]
  )

  return NextResponse.json({ ok: true, channel_id: ch.id })
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/channels/join', _POST)
