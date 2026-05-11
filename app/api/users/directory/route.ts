import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * User Directory API — Slack users.list / users.info parity.
 *
 * GET /api/users/directory — list all users (paginated, filterable)
 *   ?search=    — name/email search
 *   ?role=      — filter by platform_role
 *   ?status=    — filter by account status (active/deactivated)
 *   ?department_id= — filter by department
 *   ?limit=     — page size (default 50)
 *   ?cursor=    — pagination cursor
 *   ?include_bots= — include bot accounts
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const search = req.nextUrl.searchParams.get('search') || ''
  const role = req.nextUrl.searchParams.get('role') || ''
  const status = req.nextUrl.searchParams.get('status') || ''
  const departmentId = req.nextUrl.searchParams.get('department_id') || ''
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') || 50), 200)
  const cursor = req.nextUrl.searchParams.get('cursor') || ''
  const includeBots = req.nextUrl.searchParams.get('include_bots') === 'true'

  let query = `
    SELECT u.id, u.email, u.display_name, u.platform_role, u.avatar_url, u.status,
           u.department_id, u.workspace_id, u.created_at,
           d.name AS department_name,
           COALESCE(
             (SELECT status_text FROM aaelink.user_status WHERE user_id = u.id), ''
           ) AS status_text,
           COALESCE(
             (SELECT status_emoji FROM aaelink.user_status WHERE user_id = u.id), ''
           ) AS status_emoji
    FROM aaelink.users u
    LEFT JOIN aaelink.departments d ON d.id = u.department_id
    WHERE 1=1
  `
  const params: unknown[] = []

  if (search) {
    params.push(`%${search}%`)
    query += ` AND (u.display_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`
  }

  if (role) {
    params.push(role)
    query += ` AND u.platform_role = $${params.length}`
  }

  if (status) {
    params.push(status)
    query += ` AND u.status = $${params.length}`
  }

  if (departmentId) {
    params.push(departmentId)
    query += ` AND u.department_id = $${params.length}`
  }

  if (!includeBots) {
    query += ` AND u.platform_role != 'bot'`
  }

  if (cursor) {
    params.push(cursor)
    query += ` AND u.id > $${params.length}`
  }

  query += ` ORDER BY u.display_name ASC LIMIT $${params.length + 1}`
  params.push(limit + 1)

  const { rows } = await pool.query(query, params)
  const hasMore = rows.length > limit
  const members = rows.slice(0, limit).map(r => {
    return {
      id: r.id,
      email: r.email,
      display_name: r.display_name,
      real_name: r.display_name,
      role: r.platform_role,
      avatar_url: r.avatar_url || '',
      account_status: r.status,
      department: r.department_name || '',
      department_id: r.department_id || '',
      status_text: r.status_text || '',
      status_emoji: r.status_emoji || '',
      is_admin: ['super_admin', 'platform_admin'].includes(String(r.platform_role)),
      is_bot: r.platform_role === 'bot',
      created_at: r.created_at,
    }
  })

  return NextResponse.json({
    members,
    response_metadata: {
      next_cursor: hasMore ? String(members[members.length - 1]?.id || '') : '',
    },
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/users/directory', _GET)
