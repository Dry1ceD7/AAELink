import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Mark as Unread — POST /api/collab/mark-unread
 *
 * Rewinds the user's read cursor for a channel to a specific message timestamp,
 * causing unread indicators to re-appear in the sidebar.
 *
 * Body: { channel_id, from_create_at }
 */
async function _POST(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()

  const { channel_id, from_create_at } = (await req.json()) as {
    channel_id?: string
    from_create_at?: number
  }
  if (!channel_id || !from_create_at) {
    return NextResponse.json({ error: 'channel_id_and_from_create_at_required' }, { status: 400 })
  }

  // Rewind the read cursor to just before the target message
  const rewindTo = from_create_at - 1

  await pool.query(
    `INSERT INTO aaelink.read_state (user_id, channel_id, last_read_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_at = $3`,
    [uid, channel_id, rewindTo]
  )

  return NextResponse.json({ ok: true, last_read_at: rewindTo })
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/collab/mark-unread', _POST)
