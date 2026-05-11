import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Follow / Unfollow a thread — POST /api/collab/thread-follow
 *
 * Body: { thread_id: string, follow: boolean }
 *
 * Inserts or removes a row in the thread_followers table so the user
 * receives (or stops receiving) notifications for new replies.
 */
async function _POST(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()

  const body = (await req.json()) as { thread_id?: string; follow?: boolean }
  const threadId = body.thread_id?.trim()
  if (!threadId) {
    return NextResponse.json({ error: 'thread_id required' }, { status: 400 })
  }

  const follow = body.follow !== false

  if (follow) {
    await pool.query(
      `INSERT INTO aaelink.thread_followers (thread_id, user_id, created_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (thread_id, user_id) DO NOTHING`,
      [threadId, uid, Date.now()]
    )
  } else {
    await pool.query(
      `DELETE FROM aaelink.thread_followers WHERE thread_id = $1 AND user_id = $2`,
      [threadId, uid]
    )
  }

  return NextResponse.json({ ok: true, following: follow })
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/collab/thread-follow', _POST)
