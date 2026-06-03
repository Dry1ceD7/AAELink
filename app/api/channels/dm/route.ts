import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Direct Messages List API.
 *
 * GET /api/channels/dm?workspace_id=...
 *
 * Returns all DM/group-DM channels the current user participates in,
 * with the latest message snippet, other participants' info, and
 * unread counts. Ordered by most recent activity.
 *
 * Also:
 * POST /api/channels/dm — create or find existing DM channel
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const workspaceId = req.nextUrl.searchParams.get('workspace_id')?.trim() || ''
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })

  const { rows } = await pool.query<{
    channel_id: string
    channel_name: string
    channel_display: string
    channel_type: string
    created_at: string
    last_message_at: string
    last_message_body: string
    last_message_user: string
    unread_count: string
  }>(`
    SELECT
      c.id AS channel_id,
      c.name AS channel_name,
      c.display_name AS channel_display,
      c.type AS channel_type,
      c.created_at::text,
      COALESCE(
        (SELECT MAX(m.created_at) FROM aaelink.messages m WHERE m.channel_id = c.id),
        c.created_at
      )::text AS last_message_at,
      COALESCE(
        (SELECT m.body FROM aaelink.messages m WHERE m.channel_id = c.id ORDER BY m.created_at DESC LIMIT 1),
        ''
      ) AS last_message_body,
      COALESCE(
        (SELECT m.user_id FROM aaelink.messages m WHERE m.channel_id = c.id ORDER BY m.created_at DESC LIMIT 1),
        ''
      ) AS last_message_user,
      COALESCE(
        (SELECT COUNT(*)::text FROM aaelink.messages m
         WHERE m.channel_id = c.id
           AND m.created_at > COALESCE((SELECT rs.last_read_at FROM aaelink.channel_read_state rs WHERE rs.channel_id = c.id AND rs.user_id = $1), 0)
           AND m.user_id <> $1),
        '0'
      ) AS unread_count
    FROM aaelink.channel_members cm
    JOIN aaelink.channels c ON c.id = cm.channel_id
    WHERE cm.user_id = $1
      AND c.workspace_id = $2
      AND c.type IN ('D', 'G')
      AND c.archived_at = 0
    ORDER BY last_message_at DESC
    LIMIT 200
  `, [uid, workspaceId])

  // For each DM, get the other participants
  const channels = await Promise.all(rows.map(async (r) => {
    const { rows: members } = await pool.query<{
      user_id: string
      username: string
      first_name: string
      last_name: string
      avatar_url: string
      status_text: string
      status_emoji: string
      last_seen_at: string
    }>(`
      SELECT u.id AS user_id, u.username, u.first_name, u.last_name,
             u.avatar_url, u.status_text, u.status_emoji,
             COALESCE(u.last_seen_at, 0)::text AS last_seen_at
      FROM aaelink.channel_members cm
      JOIN aaelink.users u ON u.id = cm.user_id
      WHERE cm.channel_id = $1 AND cm.user_id <> $2
      LIMIT 8
    `, [r.channel_id, uid])

    // Truncate last message for preview
    const preview = r.last_message_body.length > 120
      ? r.last_message_body.substring(0, 120) + '…'
      : r.last_message_body

    return {
      channel_id: r.channel_id,
      channel_name: r.channel_name,
      channel_display: r.channel_display,
      type: r.channel_type === 'G' ? 'group_dm' : 'dm',
      created_at: Number(r.created_at),
      last_message_at: Number(r.last_message_at),
      last_message_preview: preview,
      last_message_user_id: r.last_message_user || null,
      unread_count: Number(r.unread_count),
      has_unread: Number(r.unread_count) > 0,
      participants: members
    }
  }))

  return NextResponse.json({
    channels,
    total: channels.length
  })
}

/** POST — create or find a DM channel between users */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    user_ids?: string[]
    workspace_id?: string
  }

  const targetIds = Array.isArray(body.user_ids) ? body.user_ids.filter(id => id && id !== uid) : []
  const workspaceId = String(body.workspace_id || '').trim()

  if (targetIds.length === 0) return NextResponse.json({ error: 'user_ids_required' }, { status: 400 })
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })

  const allUserIds = [uid, ...targetIds].sort()
  const isGroupDM = targetIds.length > 1
  const channelType = isGroupDM ? 'G' : 'D'

  // Check for existing DM between exact same participants
  const dmName = `dm_${allUserIds.join('_')}`

  const { rows: existing } = await pool.query<{ id: string }>(`
    SELECT id FROM aaelink.channels
    WHERE name = $1 AND workspace_id = $2 AND type = $3
    LIMIT 1
  `, [dmName, workspaceId, channelType])

  if (existing[0]) {
    return NextResponse.json({ channel_id: existing[0].id, created: false })
  }

  // Create new DM channel
  const { randomUUID } = await import('crypto')
  const channelId = randomUUID()
  const now = Date.now()

  // Get display names for channel name
  const { rows: users } = await pool.query<{ username: string; first_name: string; last_name: string }>(`
    SELECT username, first_name, last_name FROM aaelink.users WHERE id = ANY($1::text[])
  `, [targetIds])

  const displayName = users.map(u => {
    const full = `${u.first_name || ''} ${u.last_name || ''}`.trim()
    return full || u.username
  }).join(', ')

  await pool.query(`
    INSERT INTO aaelink.channels (id, workspace_id, name, display_name, type, created_by, created_at, updated_at, archived_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $7, 0)
  `, [channelId, workspaceId, dmName, displayName, channelType, uid, now])

  // Add all participants as members
  for (const userId of allUserIds) {
    await pool.query(`
      INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
      VALUES ($1, $2, 'member', $3) ON CONFLICT DO NOTHING
    `, [channelId, userId, now])
  }

  return NextResponse.json({ channel_id: channelId, created: true, display_name: displayName })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/channels/dm', _GET)
export const POST   = tracedRoute('POST', '/api/channels/dm', _POST)
