import { NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Activity Feed API — GET /api/activity
 *
 * Returns a unified feed of activity relevant to the current user:
 * - Messages that @mention the user
 * - Reactions on the user's messages
 * - Thread replies on messages the user authored
 * - Channel join/invite notifications
 *
 * This mirrors Slack's "Activity" tab — a single pane showing
 * everything that happened that involves the current user.
 *
 * Query params:
 *   workspace_id (required)
 *   limit (optional, default 50, max 100)
 *   before (optional, epoch ms — for pagination)
 *   filter (optional, 'mentions' | 'reactions' | 'threads' | 'all')
 */
async function _GET(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()

  const url = new URL(req.url)
  const workspaceId = url.searchParams.get('workspace_id')?.trim()
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })

  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 100)
  const before = Number(url.searchParams.get('before')) || 0
  const filter = url.searchParams.get('filter') || 'all'
  const beforeClause = before > 0 ? `AND activity_at < ${before}` : ''

  // Union of 3 activity sources
  const queries: string[] = []
  const params: (string | number)[] = [uid, workspaceId]
  let pIdx = 3

  // 1. Mentions: messages in workspace channels that contain @username
  if (filter === 'all' || filter === 'mentions') {
    const { rows: userRow } = await pool.query<{ username: string }>(
      `SELECT username FROM aaelink.users WHERE id = $1`, [uid]
    )
    const username = userRow[0]?.username || ''
    if (username) {
      queries.push(`
        SELECT
          m.id AS source_id,
          'mention' AS activity_type,
          m.body AS body,
          m.user_id AS actor_id,
          u.username AS actor_username,
          u.first_name AS actor_first_name,
          u.last_name AS actor_last_name,
          u.avatar_url AS actor_avatar_url,
          m.channel_id,
          c.display_name AS channel_name,
          c.type AS channel_type,
          m.root_id,
          m.created_at AS activity_at
        FROM aaelink.messages m
        JOIN aaelink.channels c ON c.id = m.channel_id AND c.workspace_id = $2
        JOIN aaelink.users u ON u.id = m.user_id
        WHERE m.user_id != $1
          AND (m.body ILIKE '%@' || $${pIdx} || '%')
          ${beforeClause}
      `)
      params.push(username)
      pIdx++
    }
  }

  // 2. Reactions on user's messages
  if (filter === 'all' || filter === 'reactions') {
    queries.push(`
      SELECT
        (r.message_id || ':' || r.user_id || ':' || r.reaction_key) AS source_id,
        'reaction' AS activity_type,
        r.reaction_key AS body,
        r.user_id AS actor_id,
        u.username AS actor_username,
        u.first_name AS actor_first_name,
        u.last_name AS actor_last_name,
        u.avatar_url AS actor_avatar_url,
        m.channel_id,
        c.display_name AS channel_name,
        c.type AS channel_type,
        m.root_id,
        r.created_at AS activity_at
      FROM aaelink.message_reactions r
      JOIN aaelink.messages m ON m.id = r.message_id
      JOIN aaelink.channels c ON c.id = m.channel_id AND c.workspace_id = $2
      JOIN aaelink.users u ON u.id = r.user_id
      WHERE m.user_id = $1
        AND r.user_id != $1
        ${beforeClause}
    `)
  }

  // 3. Thread replies on user's root messages
  if (filter === 'all' || filter === 'threads') {
    queries.push(`
      SELECT
        reply.id AS source_id,
        'thread_reply' AS activity_type,
        reply.body AS body,
        reply.user_id AS actor_id,
        u.username AS actor_username,
        u.first_name AS actor_first_name,
        u.last_name AS actor_last_name,
        u.avatar_url AS actor_avatar_url,
        reply.channel_id,
        c.display_name AS channel_name,
        c.type AS channel_type,
        reply.root_id,
        reply.created_at AS activity_at
      FROM aaelink.messages reply
      JOIN aaelink.messages root ON root.id = reply.root_id
      JOIN aaelink.channels c ON c.id = reply.channel_id AND c.workspace_id = $2
      JOIN aaelink.users u ON u.id = reply.user_id
      WHERE root.user_id = $1
        AND reply.user_id != $1
        AND reply.root_id IS NOT NULL AND reply.root_id != ''
        ${beforeClause}
    `)
  }

  if (queries.length === 0) {
    return NextResponse.json({ activities: [], has_more: false })
  }

  const unionQuery = `
    SELECT * FROM (
      ${queries.join(' UNION ALL ')}
    ) AS combined
    ORDER BY activity_at DESC
    LIMIT ${limit + 1}
  `

  const { rows } = await pool.query(unionQuery, params)

  const hasMore = rows.length > limit
  const activities = rows.slice(0, limit).map(r => ({
    source_id: r.source_id,
    activity_type: r.activity_type,
    body: (r.body || '').slice(0, 300),
    actor_id: r.actor_id,
    actor_username: r.actor_username,
    actor_first_name: r.actor_first_name || '',
    actor_last_name: r.actor_last_name || '',
    actor_avatar_url: r.actor_avatar_url || '',
    channel_id: r.channel_id,
    channel_name: r.channel_name,
    channel_type: r.channel_type,
    root_id: r.root_id || '',
    activity_at: Number(r.activity_at) || 0
  }))

  return NextResponse.json({ activities, has_more: hasMore })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/activity', _GET)
