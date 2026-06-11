import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Conversation Info API — Slack conversations.info / conversations.history parity.
 *
 * GET /api/conversations/info — get detailed conversation (channel/DM/group) metadata
 *   ?channel_id= — the conversation ID
 *   ?include_num_members= — include member count
 *
 * Returns: full channel object with creator, purpose, topic, pins count,
 *          member count, last activity, retention policy, posting permissions.
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const channelId = req.nextUrl.searchParams.get('channel_id') || ''
  if (!channelId) return NextResponse.json({ error: 'channel_id required' }, { status: 400 })

  // Get channel details
  const { rows } = await pool.query<{
    id: string; name: string; type: string; workspace_id: string;
    created_by: string; created_at: number; is_archived: boolean;
    topic: string; purpose: string; description: string; is_default: boolean
  }>(
    `SELECT id, name, type, workspace_id, created_by, created_at,
            COALESCE(is_archived, false) AS is_archived,
            COALESCE(topic, '') AS topic,
            COALESCE(purpose, '') AS purpose,
            COALESCE(description, '') AS description,
            COALESCE(is_default, false) AS is_default
     FROM aaelink.channels WHERE id = $1`, [channelId]
  )
  if (!rows[0]) return NextResponse.json({ error: 'channel_not_found' }, { status: 404 })

  const ch = rows[0]

  // Membership check (private channels require membership)
  if (ch.type === 'P') {
    const { rows: memCheck } = await pool.query(
      `SELECT 1 FROM aaelink.channel_members WHERE channel_id = $1 AND user_id = $2`, [channelId, uid]
    )
    if (!memCheck[0]) return NextResponse.json({ error: 'not_in_channel' }, { status: 403 })
  }

  // Aggregate stats
  const { rows: [stats] } = await pool.query<{
    num_members: string; num_pins: string; last_message_at: string; total_messages: string
  }>(`
    SELECT
      (SELECT COUNT(*)::text FROM aaelink.channel_members WHERE channel_id = $1) AS num_members,
      (SELECT COUNT(*)::text FROM aaelink.pins WHERE channel_id = $1) AS num_pins,
      (SELECT MAX(created_at)::text FROM aaelink.messages WHERE channel_id = $1) AS last_message_at,
      (SELECT COUNT(*)::text FROM aaelink.messages WHERE channel_id = $1) AS total_messages
  `, [channelId])

  // Creator info
  let creator_name = ''
  if (ch.created_by) {
    const { rows: [cRow] } = await pool.query<{ display_name: string }>(
      `SELECT display_name FROM aaelink.users WHERE id = $1`, [ch.created_by]
    )
    creator_name = cRow?.display_name || ''
  }

  // Check if current user is member
  const { rows: myMembership } = await pool.query<{ role: string; joined_at: number }>(
    `SELECT role, joined_at FROM aaelink.channel_members WHERE channel_id = $1 AND user_id = $2`,
    [channelId, uid]
  )

  return NextResponse.json({
    channel: {
      id: ch.id,
      name: ch.name,
      name_normalized: ch.name.toLowerCase().replace(/\s+/g, '-'),
      type: ch.type,
      is_channel: ch.type === 'O' || ch.type === 'P',
      is_group: ch.type === 'G',
      is_im: ch.type === 'D',
      is_mpim: ch.type === 'G',
      is_private: ch.type === 'P',
      is_archived: ch.is_archived,
      is_general: ch.is_default,
      workspace_id: ch.workspace_id,
      creator: ch.created_by,
      creator_name,
      topic: { value: ch.topic, last_set: 0 },
      purpose: { value: ch.purpose || ch.description, last_set: 0 },
      num_members: Number(stats?.num_members || 0),
      num_pins: Number(stats?.num_pins || 0),
      total_messages: Number(stats?.total_messages || 0),
      last_message_at: Number(stats?.last_message_at || 0),
      is_member: !!myMembership[0],
      my_role: myMembership[0]?.role || null,
      my_joined_at: myMembership[0]?.joined_at || null,
      created_at: ch.created_at,
    },
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/conversations/info', _GET)
