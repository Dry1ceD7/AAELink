import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { filterSearchBlocked } from '@/lib/enterprise/barrierGuard'

/** Raw row shape selected from aaelink.users (+ presence). */
interface UserSearchRow {
  id: string
  username: string
  first_name: string | null
  last_name: string | null
  email: string
  avatar_url: string | null
  job_title: string | null
  phone: string | null
  timezone: string | null
  status_text: string | null
  status_emoji: string | null
  department: string | null
  platform_role: string | null
  pronouns: string | null
  presence_status: string | null
}

/**
 * Project a raw row to the directory-facing user object. timezone + pronouns
 * are guaranteed present (empty string, never null) so the People directory can
 * filter on them without null guards.
 */
function serializeUser(r: UserSearchRow) {
  return {
    id: r.id,
    username: r.username,
    first_name: r.first_name || '',
    last_name: r.last_name || '',
    email: r.email,
    avatar_url: r.avatar_url || '',
    job_title: r.job_title || '',
    phone: r.phone || '',
    timezone: r.timezone || '',
    pronouns: r.pronouns || '',
    status_text: r.status_text || '',
    status_emoji: r.status_emoji || '',
    department: r.department || '',
    platform_role: r.platform_role || '',
    presence_status: r.presence_status || 'offline',
  }
}

/**
 * GET /api/search/users?q=...&workspace_id=...&limit=...
 *
 * Search users by username, name, email, department, or job title.
 * Optional workspace_id scopes results to workspace members only.
 * Returns enriched user objects including presence, timezone, and pronouns.
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

  const { rows } = await pool.query<UserSearchRow>(query, params)

  const blocked = await filterSearchBlocked(pool, uid, rows.map((r: { id: string }) => r.id))
  const users = rows
    .filter((r: { id: string }) => !blocked.has(r.id))
    // Normalize the response so timezone + pronouns (and the other
    // directory-facing fields) are always present strings, never null —
    // PeopleDirectoryPanel filters on timezone/pronouns directly.
    .map(serializeUser)

  return NextResponse.json({
    users,
    query: q,
    count: users.length,
    workspace_scoped: !!workspaceId
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/search/users', _GET)
