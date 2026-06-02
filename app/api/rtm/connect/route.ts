import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * RTM (Real-Time Messaging) Connect API — Slack rtm.connect parity.
 *
 * POST /api/rtm/connect — initiate a real-time messaging session
 *   Returns an SSE endpoint URL and initial connection state,
 *   including the authenticated user's info, active channels, and teams.
 *
 * This replaces Slack's WebSocket-based RTM with our SSE-based
 * real-time infrastructure (collab/presence/stream).
 *
 * GET /api/rtm/connect — lightweight health/info endpoint
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  return NextResponse.json({
    ok: true,
    protocol: 'sse',
    url: '/api/collab/presence/stream',
    info: 'Use the SSE stream URL to receive real-time events. Send events via POST to /api/collab/typing, /api/collab/read-state, etc.',
  })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    batch_presence_aware?: boolean
    presence_sub?: boolean
  }

  // Fetch self info
  const { rows: userRows } = await pool.query<{
    id: string; username: string; display_name: string; email: string;
    avatar_url: string; status_text: string; status_emoji: string;
    platform_role: string; timezone: string;
  }>(
    `SELECT id, username, display_name, email, avatar_url, status_text, status_emoji, platform_role, timezone
     FROM aaelink.users WHERE id = $1`,
    [uid]
  )
  if (!userRows[0]) return NextResponse.json({ error: 'user_not_found' }, { status: 404 })

  const self = userRows[0]

  // Fetch user's workspace memberships
  const { rows: teamRows } = await pool.query(
    `SELECT w.id, w.name, w.icon_url, wm.role
     FROM aaelink.workspace_members wm
     JOIN aaelink.workspaces w ON w.id = wm.workspace_id
     WHERE wm.user_id = $1
     ORDER BY w.name ASC`,
    [uid]
  )

  // Fetch user's channel memberships (limit to first 100)
  const { rows: channelRows } = await pool.query(
    `SELECT c.id, c.display_name, c.channel_type, c.workspace_id, c.is_archived
     FROM aaelink.channel_members cm
     JOIN aaelink.channels c ON c.id = cm.channel_id
     WHERE cm.user_id = $1 AND c.is_archived = false
     ORDER BY c.display_name ASC
     LIMIT 100`,
    [uid]
  )

  return NextResponse.json({
    ok: true,
    url: '/api/collab/presence/stream',
    protocol: 'sse',
    self: {
      id: self.id,
      name: self.username,
      display_name: self.display_name,
      email: self.email,
      avatar_url: self.avatar_url,
      status_text: self.status_text,
      status_emoji: self.status_emoji,
      role: self.platform_role,
      timezone: self.timezone,
    },
    team: teamRows.length > 0 ? {
      id: teamRows[0].id,
      name: teamRows[0].name,
      icon_url: teamRows[0].icon_url,
    } : null,
    teams: teamRows,
    channels: channelRows.map(c => ({
      id: c.id,
      name: c.display_name,
      type: c.channel_type,
      workspace_id: c.workspace_id,
    })),
    events_api: {
      typing: '/api/collab/typing',
      presence: '/api/collab/presence',
      read_state: '/api/collab/read-state',
      stream: '/api/collab/presence/stream',
    },
    batch_presence_aware: body.batch_presence_aware ?? false,
    presence_sub: body.presence_sub ?? false,
  })
}

export const GET  = tracedRoute('GET',  '/api/rtm/connect', _GET)
export const POST = tracedRoute('POST', '/api/rtm/connect', _POST)
