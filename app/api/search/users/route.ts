import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { filterSearchBlocked } from '@/lib/enterprise/barrierGuard'

/**
 * GET /api/search/users?q=...&workspace_id=...&limit=...
 *
 * Search users by username, name, email, department, or job title.
 * Optional workspace_id scopes results to workspace members only.
 * Returns enriched user objects including presence and role info.
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('q')?.trim() || ''
  const workspaceId = req.nextUrl.searchParams.get('workspace_id')?.trim() || ''
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit')) || 20, 1), 50)

  if (!q || q.length < 1) {
    return NextResponse.json({ users: [], query: q, count: 0 })
  }

  const pattern = `%${q}%`

  let query: string
  const params: (string | number)[] = [pattern]

  if (workspaceId) {
    // Scoped to workspace members
    params.push(workspaceId)
    params.push(limit)
    query = `
      SELECT u.id, u.username, u.first_name, u.last_name, u.email,
             u.avatar_url, u.job_title, u.phone, u.timezone,
             u.status_text, u.status_emoji, u.department,
             u.platform_role, u.pronouns,
             us.status AS presence_status
      FROM aaelink.users u
      JOIN aaelink.workspace_members wm ON wm.user_id = u.id AND wm.workspace_id = $2
      LEFT JOIN aaelink.user_status us ON us.user_id = u.id
      WHERE (u.username ILIKE $1 OR u.first_name ILIKE $1 OR u.last_name ILIKE $1
             OR u.email ILIKE $1 OR u.department ILIKE $1 OR u.job_title ILIKE $1)
      ORDER BY
        CASE WHEN u.username ILIKE $1 THEN 0 ELSE 1 END,
        u.username ASC
      LIMIT $3
    `
  } else {
    // Global search
    params.push(limit)
    query = `
      SELECT u.id, u.username, u.first_name, u.last_name, u.email,
             u.avatar_url, u.job_title, u.phone, u.timezone,
             u.status_text, u.status_emoji, u.department,
             u.platform_role, u.pronouns,
             us.status AS presence_status
      FROM aaelink.users u
      LEFT JOIN aaelink.user_status us ON us.user_id = u.id
      WHERE (u.username ILIKE $1 OR u.first_name ILIKE $1 OR u.last_name ILIKE $1
             OR u.email ILIKE $1 OR u.department ILIKE $1 OR u.job_title ILIKE $1)
      ORDER BY
        CASE WHEN u.username ILIKE $1 THEN 0 ELSE 1 END,
        u.username ASC
      LIMIT $2
    `
  }

  const { rows } = await pool.query(query, params)

  const blocked = await filterSearchBlocked(pool, uid, rows.map((r: { id: string }) => r.id))
  const users = rows.filter((r: { id: string }) => !blocked.has(r.id))

  return NextResponse.json({
    users,
    query: q,
    count: users.length,
    workspace_scoped: !!workspaceId
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/search/users', _GET)
