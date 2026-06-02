import { NextResponse, type NextRequest } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * GET /api/bootstrap?workspace_id=...
 *
 * Single-round-trip mount payload for the home shell. Replaces the v0.0.40
 * waterfall (5 sequential `apiFetch`s on mount = ~1s of TTFB) with one parallel
 * server-side query batch. The shape mirrors the individual endpoints so
 * callers can fall back to the fine-grained APIs without code changes.
 *
 * Audit doc: §2.3.
 */
async function _GET(req: NextRequest) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()

  const workspaceId = req.nextUrl.searchParams.get('workspace_id')?.trim() || ''

  // ── Always-fetched: user + workspaces ──────────────────────────────
  const userPromise = pool.query(
    `SELECT id, username, email, first_name, last_name, nickname, platform_role,
            avatar_url, job_title, phone, timezone, status_text, status_emoji,
            pronouns, department
     FROM aaelink.users WHERE id = $1`,
    [uid]
  )

  const teamsPromise = pool.query<{
    id: string
    name: string
    display_name: string
    is_system: boolean
  }>(
    `SELECT w.id, w.name, w.display_name, w.is_system
     FROM aaelink.workspaces w
     INNER JOIN aaelink.workspace_members m ON m.workspace_id = w.id AND m.user_id = $1
     ORDER BY w.is_system DESC, w.created_at ASC`,
    [uid]
  )

  // ── Workspace-scoped (only when workspace_id is provided) ──────────
  type ChannelRow = {
    id: string
    workspace_id: string
    name: string
    display_name: string
    type: string
    is_default: boolean
    archived: boolean
    purpose: string | null
    topic: string | null
    creator_id: string | null
    created_at: number
    member_count: number
    unread_count: number
  }
  type MemberRow = {
    id: string
    username: string
    first_name: string | null
    last_name: string | null
    nickname: string | null
    avatar_url: string | null
  }

  const wsScoped = workspaceId
    ? Promise.all([
        pool.query<ChannelRow>(
          `SELECT c.id, c.workspace_id, c.name, c.display_name, c.type,
                  COALESCE(c.is_default, false) AS is_default,
                  COALESCE(c.archived, false) AS archived,
                  c.purpose, c.topic, c.creator_id, c.created_at,
                  (SELECT COUNT(*)::int FROM aaelink.channel_members cm WHERE cm.channel_id = c.id) AS member_count,
                  (SELECT COUNT(*)::int FROM aaelink.messages m
                     WHERE m.channel_id = c.id
                       AND m.created_at > COALESCE(
                         (SELECT rs.last_read_at FROM aaelink.channel_read_state rs
                            WHERE rs.channel_id = c.id AND rs.user_id = $1), 0)
                       AND m.user_id <> $1) AS unread_count
           FROM aaelink.channels c
           INNER JOIN aaelink.channel_members cm ON cm.channel_id = c.id AND cm.user_id = $1
           WHERE c.workspace_id = $2 AND COALESCE(c.archived, false) = false
           ORDER BY c.is_default DESC, c.display_name ASC`,
          [uid, workspaceId]
        ),
        pool.query<MemberRow>(
          `SELECT u.id, u.username, u.first_name, u.last_name, u.nickname, u.avatar_url
           FROM aaelink.users u
           INNER JOIN aaelink.workspace_members m ON m.user_id = u.id
           WHERE m.workspace_id = $1
           ORDER BY u.username ASC`,
          [workspaceId]
        ),
      ])
    : Promise.resolve(null)

  const [userResult, teamsResult, wsResult] = await Promise.all([
    userPromise,
    teamsPromise,
    wsScoped,
  ])

  const user = userResult.rows[0]
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const channels = wsResult ? wsResult[0].rows : []
  const members = wsResult ? wsResult[1].rows : []

  return NextResponse.json({
    user,
    teams: teamsResult.rows,
    workspace_id: workspaceId || null,
    channels,
    members,
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET = tracedRoute('GET', '/api/bootstrap', _GET)
