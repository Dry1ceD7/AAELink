import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Workspace Switcher API — enriched workspace list for sidebar switcher.
 *
 * GET /api/workspaces/switcher
 *
 * Returns all workspaces the user belongs to, with:
 *   - Total unread counts per workspace
 *   - Total mention counts per workspace
 *   - Member count
 *   - Channel count
 *   - User's role in each workspace
 *
 * Powers the workspace switcher sidebar with badge counts (like Slack).
 */
async function _GET() {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows } = await pool.query<{
    id: string
    name: string
    display_name: string
    is_system: boolean
    created_at: string
    role: string
    member_count: string
    channel_count: string
  }>(`
    SELECT
      w.id, w.name, w.display_name, w.is_system, w.created_at::text,
      wm.role,
      (SELECT COUNT(*)::text FROM aaelink.workspace_members wm2 WHERE wm2.workspace_id = w.id) AS member_count,
      (SELECT COUNT(*)::text FROM aaelink.channels c WHERE c.workspace_id = w.id AND c.archived_at = 0) AS channel_count
    FROM aaelink.workspaces w
    JOIN aaelink.workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = $1
    ORDER BY w.is_system DESC, w.created_at ASC
  `, [uid])

  // Get unread + mention counts per workspace
  const workspaces = await Promise.all(rows.map(async (w) => {
    const { rows: unreadRows } = await pool.query<{ unread_total: string; mention_total: string }>(`
      SELECT
        COALESCE(SUM(
          CASE WHEN m.created_at > COALESCE(rs.last_read_at, 0) AND m.user_id <> $1 THEN 1 ELSE 0 END
        ), 0)::text AS unread_total,
        COALESCE(SUM(
          CASE WHEN m.created_at > COALESCE(rs.last_read_at, 0) AND m.user_id <> $1
               AND (m.body ILIKE '%@' || u2.username || '%' OR m.body ILIKE '%@channel%' OR m.body ILIKE '%@here%')
               THEN 1 ELSE 0 END
        ), 0)::text AS mention_total
      FROM aaelink.channel_members cm
      JOIN aaelink.channels c ON c.id = cm.channel_id AND c.workspace_id = $2 AND c.archived_at = 0
      LEFT JOIN LATERAL (
        SELECT m2.created_at, m2.user_id, m2.body
        FROM aaelink.messages m2
        WHERE m2.channel_id = c.id AND (m2.root_id IS NULL OR m2.root_id = '')
        ORDER BY m2.created_at DESC
        LIMIT 50
      ) m ON true
      LEFT JOIN aaelink.read_state rs ON rs.channel_id = c.id AND rs.user_id = $1
      LEFT JOIN aaelink.users u2 ON u2.id = $1
      WHERE cm.user_id = $1
    `, [uid, w.id])

    return {
      id: w.id,
      name: w.name,
      display_name: w.display_name,
      is_system: w.is_system,
      created_at: Number(w.created_at),
      role: w.role,
      member_count: Number(w.member_count),
      channel_count: Number(w.channel_count),
      unread_count: Number(unreadRows[0]?.unread_total || 0),
      mention_count: Number(unreadRows[0]?.mention_total || 0),
      has_unreads: Number(unreadRows[0]?.unread_total || 0) > 0
    }
  }))

  return NextResponse.json({
    workspaces,
    total: workspaces.length,
    total_unreads: workspaces.reduce((a, w) => a + w.unread_count, 0),
    total_mentions: workspaces.reduce((a, w) => a + w.mention_count, 0)
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/workspaces/switcher', _GET)
