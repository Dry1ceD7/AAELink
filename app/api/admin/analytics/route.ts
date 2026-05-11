import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { isPlatformAdmin } from '@/lib/platformRole'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * GET /api/admin/analytics?period=7d|30d|90d&workspace_id=...
 *
 * Extended analytics dashboard data beyond basic stats:
 *  - Daily message volume (time-series)
 *  - Daily active users (time-series)
 *  - Top channels by message count
 *  - Top users by message count
 *  - Reaction usage stats
 *  - Channel growth over time
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!isPlatformAdmin(uRows[0]?.platform_role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const periodParam = req.nextUrl.searchParams.get('period') || '7d'
  const workspaceId = req.nextUrl.searchParams.get('workspace_id')?.trim() || ''

  const days = periodParam === '90d' ? 90 : periodParam === '30d' ? 30 : 7
  const now = Date.now()
  const msPerDay = 24 * 60 * 60 * 1000
  const since = now - days * msPerDay

  // Common workspace filter
  const wsFilter = workspaceId ? `AND c.workspace_id = '${workspaceId.replace(/'/g, "''")}'` : ''
  const wsFilterDirect = workspaceId ? `AND wm.workspace_id = '${workspaceId.replace(/'/g, "''")}'` : ''

  // ── 1. Daily message volume ─────────────────────────────────────
  const { rows: dailyMessages } = await pool.query<{ day: string; count: string }>(`
    SELECT
      to_char(to_timestamp(m.created_at / 1000.0), 'YYYY-MM-DD') AS day,
      COUNT(*)::text AS count
    FROM aaelink.messages m
    JOIN aaelink.channels c ON c.id = m.channel_id
    WHERE m.created_at >= $1
      ${wsFilter}
    GROUP BY day
    ORDER BY day ASC
  `, [since])

  // ── 2. Daily active users ───────────────────────────────────────
  const { rows: dailyActive } = await pool.query<{ day: string; count: string }>(`
    SELECT
      to_char(to_timestamp(m.created_at / 1000.0), 'YYYY-MM-DD') AS day,
      COUNT(DISTINCT m.user_id)::text AS count
    FROM aaelink.messages m
    JOIN aaelink.channels c ON c.id = m.channel_id
    WHERE m.created_at >= $1
      ${wsFilter}
    GROUP BY day
    ORDER BY day ASC
  `, [since])

  // ── 3. Top channels by message count ─────────────────────────────
  const { rows: topChannels } = await pool.query<{
    channel_id: string; channel_name: string; message_count: string
  }>(`
    SELECT c.id AS channel_id, c.display_name AS channel_name,
           COUNT(m.id)::text AS message_count
    FROM aaelink.messages m
    JOIN aaelink.channels c ON c.id = m.channel_id
    WHERE m.created_at >= $1 AND c.type IN ('O','P')
      ${wsFilter}
    GROUP BY c.id, c.display_name
    ORDER BY COUNT(m.id) DESC
    LIMIT 10
  `, [since])

  // ── 4. Top users by message count ────────────────────────────────
  const { rows: topUsers } = await pool.query<{
    user_id: string; username: string; display_name: string; message_count: string
  }>(`
    SELECT u.id AS user_id, u.username,
           COALESCE(NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''), u.username) AS display_name,
           COUNT(m.id)::text AS message_count
    FROM aaelink.messages m
    JOIN aaelink.users u ON u.id = m.user_id
    JOIN aaelink.channels c ON c.id = m.channel_id
    WHERE m.created_at >= $1
      ${wsFilter}
    GROUP BY u.id, u.username, u.first_name, u.last_name
    ORDER BY COUNT(m.id) DESC
    LIMIT 10
  `, [since])

  // ── 5. Reaction stats ────────────────────────────────────────────
  const { rows: topReactions } = await pool.query<{ emoji: string; count: string }>(`
    SELECT r.emoji_name AS emoji, COUNT(*)::text AS count
    FROM aaelink.message_reactions r
    JOIN aaelink.messages m ON m.id = r.message_id
    JOIN aaelink.channels c ON c.id = m.channel_id
    WHERE m.created_at >= $1
      ${wsFilter}
    GROUP BY r.emoji_name
    ORDER BY COUNT(*) DESC
    LIMIT 15
  `, [since])

  // ── 6. Channel growth (new channels created) ────────────────────
  const { rows: channelGrowth } = await pool.query<{ day: string; count: string }>(`
    SELECT
      to_char(to_timestamp(c.created_at / 1000.0), 'YYYY-MM-DD') AS day,
      COUNT(*)::text AS count
    FROM aaelink.channels c
    WHERE c.created_at >= $1 AND c.type IN ('O','P')
      ${wsFilter.replace('AND c.', 'AND c.')}
    GROUP BY day
    ORDER BY day ASC
  `, [since])

  // ── 7. User growth (new signups) ────────────────────────────────
  const { rows: userGrowth } = await pool.query<{ day: string; count: string }>(`
    SELECT
      to_char(to_timestamp(u.created_at / 1000.0), 'YYYY-MM-DD') AS day,
      COUNT(*)::text AS count
    FROM aaelink.users u
    WHERE u.created_at >= $1
    GROUP BY day
    ORDER BY day ASC
  `, [since])

  return NextResponse.json({
    period: periodParam,
    days,
    since,
    analytics: {
      daily_messages: dailyMessages.map(r => ({ day: r.day, count: Number(r.count) })),
      daily_active_users: dailyActive.map(r => ({ day: r.day, count: Number(r.count) })),
      top_channels: topChannels.map(r => ({
        channel_id: r.channel_id,
        channel_name: r.channel_name,
        message_count: Number(r.message_count)
      })),
      top_users: topUsers.map(r => ({
        user_id: r.user_id,
        username: r.username,
        display_name: r.display_name,
        message_count: Number(r.message_count)
      })),
      top_reactions: topReactions.map(r => ({ emoji: r.emoji, count: Number(r.count) })),
      channel_growth: channelGrowth.map(r => ({ day: r.day, count: Number(r.count) })),
      user_growth: userGrowth.map(r => ({ day: r.day, count: Number(r.count) }))
    }
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/admin/analytics', _GET)
