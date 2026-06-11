import { NextResponse, type NextRequest } from 'next/server'
import { userCanReadChannel } from '@/lib/enterprise/collab-access'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { tracedRoute } from '@/lib/api/tracedRoute'

/** Advance read cursor for a channel (root messages only; uses max with server value). */
async function _POST(req: NextRequest) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  let body: { channel_id?: unknown; last_read_at?: unknown; mode?: unknown }
  try {
    body = (await req.json()) as { channel_id?: unknown; last_read_at?: unknown; mode?: unknown }
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const channelId = typeof body.channel_id === 'string' ? body.channel_id.trim() : ''
  const lastReadAt = Number(body.last_read_at)
  const mode = body.mode === 'set' ? 'set' : 'advance'
  if (!channelId || !Number.isFinite(lastReadAt) || lastReadAt < 0) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
  }
  await ensureSchema()
  if (!(await userCanReadChannel(pool, uid, channelId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  if (mode === 'set') {
    await pool.query(
      `INSERT INTO aaelink.channel_read_state (user_id, channel_id, last_read_at)
       VALUES ($1, $2, $3::bigint)
       ON CONFLICT (user_id, channel_id) DO UPDATE SET
         last_read_at = EXCLUDED.last_read_at`,
      [uid, channelId, Math.floor(lastReadAt)]
    )
  } else {
    await pool.query(
      `INSERT INTO aaelink.channel_read_state (user_id, channel_id, last_read_at)
       VALUES ($1, $2, $3::bigint)
       ON CONFLICT (user_id, channel_id) DO UPDATE SET
         last_read_at = GREATEST(aaelink.channel_read_state.last_read_at, EXCLUDED.last_read_at)`,
      [uid, channelId, Math.floor(lastReadAt)]
    )
  }
  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/collab/read-state', _POST)
