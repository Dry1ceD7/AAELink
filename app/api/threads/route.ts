import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { verifyCsrf } from '@/lib/auth/csrf'
import { writeAuditLog } from '@/lib/enterprise/auditLog'

/** GET /api/threads — list threads (root messages) the current user participates in. */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const wsId = req.nextUrl.searchParams.get('workspace_id') || ''
  if (!wsId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })

  // Find all threads in the workspace plus mark whether the current user is following
  // (they authored the root, OR they have a row in thread_followers — explicit
  // follow/unfollow via /api/collab/thread-follow) and how many replies are unread
  // relative to their channel-read state.
  const { rows } = await pool.query(
    `WITH all_threads AS (
       -- All root messages that have at least one reply in this workspace
       SELECT DISTINCT m.id AS root_id
       FROM aaelink.messages m
       JOIN aaelink.channels c ON c.id = m.channel_id
       WHERE m.root_id = '' AND c.workspace_id = $2
         AND EXISTS (SELECT 1 FROM aaelink.messages r WHERE r.root_id = m.id LIMIT 1)
     )
     SELECT rm.id, rm.channel_id, rm.user_id AS author_id, rm.body, rm.created_at,
            c.display_name AS channel_name,
            (SELECT COUNT(*) FROM aaelink.messages r WHERE r.root_id = rm.id) AS reply_count,
            (SELECT MAX(r.created_at) FROM aaelink.messages r WHERE r.root_id = rm.id) AS last_reply_at,
            (
              rm.user_id = $1
              OR EXISTS (
                SELECT 1 FROM aaelink.thread_followers tf
                WHERE tf.thread_id = rm.id AND tf.user_id = $1
              )
            ) AS is_following,
            (
              SELECT COUNT(*) FROM aaelink.messages r
              WHERE r.root_id = rm.id
                AND r.user_id <> $1
                AND r.created_at > COALESCE(
                  (SELECT rs.last_read_at FROM aaelink.channel_read_state rs
                    WHERE rs.channel_id = rm.channel_id AND rs.user_id = $1), 0)
            ) AS unread_count
     FROM all_threads at
     JOIN aaelink.messages rm ON rm.id = at.root_id
     JOIN aaelink.channels c ON c.id = rm.channel_id
     ORDER BY last_reply_at DESC NULLS LAST
     LIMIT 100`,
    [uid, wsId]
  )

  return NextResponse.json({ threads: rows })
}

/**
 * POST /api/threads/mark-read — mark every thread the user is following as read.
 *
 * Bumps the user's `channel_read_state.last_read_at` to "now" for every
 * channel that contains at least one thread they're following with unread
 * replies. This is the equivalent of Slack's "Mark all as read" button on
 * the Threads pane.
 */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const csrfErr = await verifyCsrf(req)
  if (csrfErr) return csrfErr

  const body = (await req.json().catch(() => ({}))) as { workspace_id?: string }
  const wsId = body.workspace_id || ''
  if (!wsId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })

  const now = Date.now()

  // Find every channel that has a thread the user is following — they authored the
  // root, OR they have a thread_followers row — and bump their channel_read_state
  // for that channel.
  const { rowCount } = await pool.query(
    `INSERT INTO aaelink.channel_read_state (user_id, channel_id, last_read_at)
     SELECT $1, c.id, $3::bigint
     FROM aaelink.channels c
     WHERE c.workspace_id = $2
       AND EXISTS (
         SELECT 1
         FROM aaelink.messages rm
         WHERE rm.channel_id = c.id
           AND rm.root_id = ''
           AND (
             rm.user_id = $1
             OR EXISTS (
               SELECT 1 FROM aaelink.thread_followers tf
               WHERE tf.thread_id = rm.id AND tf.user_id = $1
             )
           )
       )
     ON CONFLICT (user_id, channel_id) DO UPDATE SET
       last_read_at = GREATEST(aaelink.channel_read_state.last_read_at, EXCLUDED.last_read_at)`,
    [uid, wsId, now]
  )

  writeAuditLog({
    pool,
    actorId: uid,
    workspaceId: wsId,
    action: 'threads.mark_all_read',
    resourceKind: 'workspace_threads',
    metadata: { channels_touched: rowCount ?? 0 },
  })

  return NextResponse.json({ ok: true, channels_marked: rowCount ?? 0 })
}

// ── Traced export ───────────────────────────────────────────────────
export const GET = tracedRoute('GET', '/api/threads', _GET)
export const POST = tracedRoute('POST', '/api/threads', _POST)
