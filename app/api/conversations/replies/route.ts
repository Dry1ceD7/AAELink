import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Conversations Replies API — Slack conversations.replies parity.
 *
 * GET /api/conversations/replies — get all replies in a thread
 *   ?channel_id= — required
 *   ?ts=         — root message ID (thread_ts)
 *   ?latest=     — end of time range
 *   ?oldest=     — start of time range
 *   ?limit=      — max replies
 *   ?cursor=     — pagination cursor
 *   ?inclusive=   — include boundary messages
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const channelId = req.nextUrl.searchParams.get('channel_id') || ''
  const ts = req.nextUrl.searchParams.get('ts') || ''
  if (!channelId || !ts) {
    return NextResponse.json({ error: 'channel_id and ts required' }, { status: 400 })
  }

  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') || 100), 1000)
  const latest = req.nextUrl.searchParams.get('latest') || ''
  const oldest = req.nextUrl.searchParams.get('oldest') || ''
  const cursor = req.nextUrl.searchParams.get('cursor') || ''
  const inclusive = req.nextUrl.searchParams.get('inclusive') === 'true'

  // Get root message + all replies
  let query = `
    SELECT m.id, m.channel_id, m.user_id, m.content, m.type, m.root_id,
           m.created_at, m.updated_at,
           u.display_name, u.avatar_url,
           (SELECT json_agg(json_build_object('name', me.emoji, 'count', me.count))
            FROM (
              SELECT mr.emoji, COUNT(*)::int AS count
              FROM aaelink.message_reactions mr WHERE mr.message_id = m.id
              GROUP BY mr.emoji
            ) me
           ) AS reactions
    FROM aaelink.messages m
    LEFT JOIN aaelink.users u ON u.id = m.user_id
    WHERE m.channel_id = $1 AND (m.id = $2 OR m.root_id = $2)
  `
  const params: unknown[] = [channelId, ts]

  if (latest) {
    params.push(Number(latest))
    query += inclusive ? ` AND m.created_at <= $${params.length}` : ` AND m.created_at < $${params.length}`
  }
  if (oldest) {
    params.push(Number(oldest))
    query += inclusive ? ` AND m.created_at >= $${params.length}` : ` AND m.created_at > $${params.length}`
  }
  if (cursor) {
    params.push(Number(cursor))
    query += ` AND m.created_at > $${params.length}`
  }

  query += ` ORDER BY m.created_at ASC LIMIT $${params.length + 1}`
  params.push(limit + 1)

  const { rows } = await pool.query(query, params)
  const hasMore = rows.length > limit
  const messages = rows.slice(0, limit).map(r => {
    return {
      type: r.type || 'message',
      user: r.user_id,
      user_name: r.display_name,
      user_avatar: r.avatar_url,
      text: r.content,
      ts: String(r.created_at),
      thread_ts: r.root_id ? String(r.root_id) : String(r.id),
      parent_user_id: r.root_id ? undefined : r.user_id,
      reactions: r.reactions || [],
    }
  })

  return NextResponse.json({
    ok: true,
    messages,
    has_more: hasMore,
    response_metadata: {
      next_cursor: hasMore ? String(messages[messages.length - 1]?.ts || '') : '',
    },
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/conversations/replies', _GET)
