import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * GET /api/channels/unread?workspace_id=...
 *
 * Returns unread message counts for all channels the user belongs to.
 * Compares each channel's latest message timestamp against the user's
 * last-read timestamp from the read_state table.
 *
 * Response: { channels: [{ channel_id, unread_count, mention_count, last_read_at }] }
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const workspaceId = req.nextUrl.searchParams.get('workspace_id')?.trim() || ''
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })

  // Get all channels the user is a member of in this workspace,
  // along with the last read timestamp and count of newer messages
  const { rows } = await pool.query<{
    channel_id: string
    channel_name: string
    channel_display: string
    unread_count: string
    mention_count: string
    last_read_at: string
    latest_message_at: string
  }>(`
    SELECT
      c.id AS channel_id,
      c.name AS channel_name,
      c.display_name AS channel_display,
      COALESCE(
        (SELECT COUNT(*)::text FROM aaelink.messages m
         WHERE m.channel_id = c.id
           AND m.created_at > COALESCE(rs.last_read_at, 0)
           AND m.user_id <> $1),
        '0'
      ) AS unread_count,
      COALESCE(
        (SELECT COUNT(*)::text FROM aaelink.messages m
         WHERE m.channel_id = c.id
           AND m.created_at > COALESCE(rs.last_read_at, 0)
           AND m.user_id <> $1
           AND (m.body ILIKE '%@' || u_self.username || '%' OR m.body LIKE '%@channel%' OR m.body LIKE '%@here%')),
        '0'
      ) AS mention_count,
      COALESCE(rs.last_read_at, 0)::text AS last_read_at,
      COALESCE(
        (SELECT MAX(m2.created_at) FROM aaelink.messages m2 WHERE m2.channel_id = c.id),
        0
      )::text AS latest_message_at
    FROM aaelink.channel_members cm
    JOIN aaelink.channels c ON c.id = cm.channel_id AND c.workspace_id = $2
    LEFT JOIN aaelink.read_state rs ON rs.channel_id = c.id AND rs.user_id = $1
    LEFT JOIN aaelink.users u_self ON u_self.id = $1
    WHERE cm.user_id = $1
      AND c.archived_at = 0
    ORDER BY c.display_name ASC
  `, [uid, workspaceId])

  return NextResponse.json({
    channels: rows.map(r => ({
      channel_id: r.channel_id,
      channel_name: r.channel_name,
      channel_display: r.channel_display,
      unread_count: Number(r.unread_count),
      mention_count: Number(r.mention_count),
      last_read_at: Number(r.last_read_at),
      latest_message_at: Number(r.latest_message_at),
      has_unread: Number(r.unread_count) > 0
    })),
    total_unread: rows.reduce((sum, r) => sum + Number(r.unread_count), 0),
    total_mentions: rows.reduce((sum, r) => sum + Number(r.mention_count), 0)
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/channels/unread', _GET)
