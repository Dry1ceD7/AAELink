import type { Pool } from 'pg'
import { NextResponse, type NextRequest } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { userCanReadChannel } from '@/lib/collab-access'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

const TYPING_TTL_MS = 8_000
const STALE_PRUNE_MS = 120_000

async function assertThreadRoot(
  pool: Pool,
  channelId: string,
  rootId: string
): Promise<boolean> {
  const { rows } = await pool.query<{ ok: number }>(
    `SELECT 1 AS ok FROM aaelink.messages
     WHERE id = $1 AND channel_id = $2 AND (root_id IS NULL OR root_id = '')`,
    [rootId, channelId]
  )
  return rows.length > 0
}

/** List user ids typing in the channel main composer, or in a thread when `root_id` is set. */
async function _GET(req: NextRequest) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const channelId = (req.nextUrl.searchParams.get('channel_id') || '').trim()
  const rootId = (req.nextUrl.searchParams.get('root_id') || '').trim()
  if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })
  await ensureSchema()
  if (!(await userCanReadChannel(pool, uid, channelId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const now = Date.now()
  const cutoff = now - TYPING_TTL_MS
  const pruneBefore = now - STALE_PRUNE_MS
  await pool.query(`DELETE FROM aaelink.channel_typing WHERE updated_at < $1`, [pruneBefore])
  await pool.query(`DELETE FROM aaelink.thread_typing WHERE updated_at < $1`, [pruneBefore])

  if (rootId) {
    if (!(await assertThreadRoot(pool, channelId, rootId))) {
      return NextResponse.json({ error: 'invalid_thread_root' }, { status: 400 })
    }
    const { rows } = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM aaelink.thread_typing
       WHERE channel_id = $1 AND root_id = $2 AND updated_at > $3 AND user_id <> $4
       ORDER BY updated_at DESC
       LIMIT 16`,
      [channelId, rootId, cutoff, uid]
    )
    return NextResponse.json({ user_ids: rows.map(r => r.user_id) })
  }

  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM aaelink.channel_typing
     WHERE channel_id = $1 AND updated_at > $2 AND user_id <> $3
     ORDER BY updated_at DESC
     LIMIT 16`,
    [channelId, cutoff, uid]
  )
  return NextResponse.json({ user_ids: rows.map(r => r.user_id) })
}

/**
 * Body: `{ channel_id: string, stop?: boolean, thread_root_id?: string }`
 * - Channel composer: no `thread_root_id`.
 * - Thread composer: `thread_root_id` = root message id.
 * - `stop: true` clears channel row, or thread row when `thread_root_id` is set.
 */
async function _POST(req: NextRequest) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  let body: { channel_id?: unknown; stop?: unknown; thread_root_id?: unknown }
  try {
    body = (await req.json()) as { channel_id?: unknown; stop?: unknown; thread_root_id?: unknown }
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const channelId = typeof body.channel_id === 'string' ? body.channel_id.trim() : ''
  const threadRootId =
    typeof body.thread_root_id === 'string' ? body.thread_root_id.trim() : ''
  if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })
  await ensureSchema()
  if (!(await userCanReadChannel(pool, uid, channelId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  if (threadRootId && !(await assertThreadRoot(pool, channelId, threadRootId))) {
    return NextResponse.json({ error: 'invalid_thread_root' }, { status: 400 })
  }

  if (body.stop === true) {
    if (threadRootId) {
      await pool.query(
        `DELETE FROM aaelink.thread_typing WHERE channel_id = $1 AND root_id = $2 AND user_id = $3`,
        [channelId, threadRootId, uid]
      )
    } else {
      await pool.query(`DELETE FROM aaelink.channel_typing WHERE channel_id = $1 AND user_id = $2`, [
        channelId,
        uid
      ])
    }
    return NextResponse.json({ ok: true })
  }

  const now = Date.now()
  if (threadRootId) {
    await pool.query(
      `INSERT INTO aaelink.thread_typing (channel_id, root_id, user_id, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (channel_id, root_id, user_id) DO UPDATE SET updated_at = EXCLUDED.updated_at`,
      [channelId, threadRootId, uid, now]
    )
  } else {
    await pool.query(
      `INSERT INTO aaelink.channel_typing (channel_id, user_id, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (channel_id, user_id) DO UPDATE SET updated_at = EXCLUDED.updated_at`,
      [channelId, uid, now]
    )
  }
  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/collab/typing', _GET)
export const POST   = tracedRoute('POST', '/api/collab/typing', _POST)
