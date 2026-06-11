import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Channel analytics for the ChannelAnalyticsPanel. Returns per-channel stats
 * for the channels the caller is a member of: membership, message volume over
 * day/week/month windows, files shared, active posters, and last activity.
 */
interface ChannelStatRow {
  id: string
  name: string
  type: string
  members: number
  messages_day: number
  messages_week: number
  messages_month: number
  files_shared: number
  active_posters: number
  last_activity: string | null
}

async function _GET(): Promise<NextResponse> {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const now = Date.now()
  const dayAgo = now - 24 * 60 * 60 * 1000
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000

  const { rows } = await pool.query<ChannelStatRow>(
    `SELECT c.id, c.display_name AS name, c.type,
            (SELECT COUNT(*)::int FROM aaelink.channel_members cm2 WHERE cm2.channel_id = c.id) AS members,
            (SELECT COUNT(*)::int FROM aaelink.messages m WHERE m.channel_id = c.id AND m.created_at >= $2) AS messages_day,
            (SELECT COUNT(*)::int FROM aaelink.messages m WHERE m.channel_id = c.id AND m.created_at >= $3) AS messages_week,
            (SELECT COUNT(*)::int FROM aaelink.messages m WHERE m.channel_id = c.id AND m.created_at >= $4) AS messages_month,
            (SELECT COUNT(*)::int FROM aaelink.message_attachments ma
               JOIN aaelink.messages m ON m.id = ma.message_id WHERE m.channel_id = c.id) AS files_shared,
            (SELECT COUNT(DISTINCT m.user_id)::int FROM aaelink.messages m
               WHERE m.channel_id = c.id AND m.created_at >= $3) AS active_posters,
            (SELECT MAX(m.created_at)::text FROM aaelink.messages m WHERE m.channel_id = c.id) AS last_activity
     FROM aaelink.channels c
     INNER JOIN aaelink.channel_members cm ON cm.channel_id = c.id AND cm.user_id = $1
     WHERE COALESCE(c.is_archived, false) = false
     ORDER BY messages_week DESC, c.display_name ASC
     LIMIT 200`,
    [uid, dayAgo, weekAgo, monthAgo]
  )

  const channels = rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type === 'P' ? 'private' : 'public',
    members: Number(r.members) || 0,
    messagesDay: Number(r.messages_day) || 0,
    messagesWeek: Number(r.messages_week) || 0,
    messagesMonth: Number(r.messages_month) || 0,
    filesShared: Number(r.files_shared) || 0,
    activePosters: Number(r.active_posters) || 0,
    topPoster: '',
    trend: 'flat' as const,
    lastActivity: r.last_activity ? new Date(Number(r.last_activity)).toISOString() : '',
  }))

  return NextResponse.json({ channels })
}

export const GET = tracedRoute('GET', '/api/analytics/channels', _GET)
