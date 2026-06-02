import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Conversation History API — Slack conversations.history parity.
 *
 * GET /api/conversations/history — paginated message history for a conversation
 *   ?channel_id= — required channel/DM/group ID
 *   ?latest=     — end of time range (epoch ms)
 *   ?oldest=     — start of time range (epoch ms)
 *   ?limit=      — max messages (default 100)
 *   ?cursor=     — pagination cursor
 *   ?inclusive=   — include boundary messages
 *
 * Returns: messages array with has_more, response_metadata.
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const channelId = req.nextUrl.searchParams.get('channel_id') || ''
  if (!channelId) return NextResponse.json({ error: 'channel_id required' }, { status: 400 })

  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') || 100), 1000)
  const latest = req.nextUrl.searchParams.get('latest') || ''
  const oldest = req.nextUrl.searchParams.get('oldest') || ''
  const cursor = req.nextUrl.searchParams.get('cursor') || ''
  const inclusive = req.nextUrl.searchParams.get('inclusive') === 'true'

  // Membership check
  const { rows: chRows } = await pool.query<{ type: string }>(
    `SELECT type FROM aaelink.channels WHERE id = $1`, [channelId]
  )
  if (!chRows[0]) return NextResponse.json({ error: 'channel_not_found' }, { status: 404 })

  if (chRows[0].type === 'P' || chRows[0].type === 'D' || chRows[0].type === 'G') {
    const { rows: memCheck } = await pool.query(
      `SELECT 1 FROM aaelink.channel_members WHERE channel_id = $1 AND user_id = $2`, [channelId, uid]
    )
    if (!memCheck[0]) return NextResponse.json({ error: 'not_in_channel' }, { status: 403 })
  }

  let query = `
    SELECT m.id, m.channel_id, m.user_id, m.content, m.type, m.root_id,
           m.created_at, m.updated_at,
           u.display_name, u.avatar_url,
           (SELECT COUNT(*)::int FROM aaelink.messages r WHERE r.root_id = m.id) AS reply_count,
           (SELECT json_agg(json_build_object('name', me.emoji, 'count', me.count))
            FROM (
              SELECT mr.emoji, COUNT(*)::int AS count
              FROM aaelink.message_reactions mr WHERE mr.message_id = m.id
              GROUP BY mr.emoji
            ) me
           ) AS reactions
    FROM aaelink.messages m
    LEFT JOIN aaelink.users u ON u.id = m.user_id
    WHERE m.channel_id = $1 AND m.root_id IS NULL
  `
  const params: unknown[] = [channelId]

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
    query += ` AND m.created_at < $${params.length}`
  }

  query += ` ORDER BY m.created_at DESC LIMIT $${params.length + 1}`
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
      thread_ts: r.root_id ? String(r.root_id) : undefined,
      reply_count: r.reply_count || 0,
      reactions: r.reactions || [],
      edited: r.updated_at && r.updated_at !== r.created_at
        ? { ts: String(r.updated_at) } : undefined,
    }
  })

  return NextResponse.json({
    ok: true,
    messages,
    has_more: hasMore,
    pin_count: 0,
    response_metadata: {
      next_cursor: hasMore ? String(messages[messages.length - 1]?.ts || '') : '',
    },
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/conversations/history', _GET)
