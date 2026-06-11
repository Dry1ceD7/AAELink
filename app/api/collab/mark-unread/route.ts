import { NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { userCanReadChannel } from '@/lib/enterprise/collab-access'

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
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  await ensureSchema()

  const { channel_id, from_create_at } = (await req.json()) as {
    channel_id?: string
    from_create_at?: number
  }
  if (!channel_id || !from_create_at) {
    return NextResponse.json({ error: 'channel_id_and_from_create_at_required' }, { status: 400 })
  }

  // Verify channel access before writing — channel_read_state has a NOT NULL FK
  // to channels, so a stale/bogus channel id would otherwise raise an unhandled
  // FK violation (500) instead of a clean response.
  if (!(await userCanReadChannel(pool, uid, channel_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Rewind the read cursor to just before the target message
  const rewindTo = from_create_at - 1

  await pool.query(
    `INSERT INTO aaelink.channel_read_state (user_id, channel_id, last_read_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_at = $3`,
    [uid, channel_id, rewindTo]
  )

  return NextResponse.json({ ok: true, last_read_at: rewindTo })
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/collab/mark-unread', _POST)
