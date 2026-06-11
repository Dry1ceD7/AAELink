// keep: slack-compat surface (intentionally addressable, may be invoked by Slack-shaped clients)
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { filterSearchBlocked } from '@/lib/enterprise/barrierGuard'
import { enforceScope, SCOPES, type OAuthGrant } from '@/lib/api/oauthScopes'

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
  // Bearer token path (users:read). Falls through to session auth when no token present.
  const scopeResult = await enforceScope(pool, req, SCOPES.USERS_READ)
  if (scopeResult.kind === 'error') return scopeResult.response
  const grant: OAuthGrant | null = scopeResult.kind === 'ok' ? scopeResult.grant : null
  const uid = grant ? grant.user_id : await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // When a bearer grant is scoped to a specific workspace, restrict the listing
  // to members of that workspace only. Session auth and unscoped grants keep
  // the existing global behaviour.
  const grantWorkspace = grant ? String(grant.workspace_id || '').trim() : ''

  const search = req.nextUrl.searchParams.get('search') || ''
  const role = req.nextUrl.searchParams.get('role') || ''
  const status = req.nextUrl.searchParams.get('status') || ''
  const departmentId = req.nextUrl.searchParams.get('department_id') || ''
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') || 50), 200)
  const cursor = req.nextUrl.searchParams.get('cursor') || ''
  const includeBots = req.nextUrl.searchParams.get('include_bots') === 'true'

  let query = `
    SELECT u.id, u.email,
           NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '') AS display_name,
           u.platform_role, u.avatar_url, u.created_at,
           u.department,
           COALESCE(
             (SELECT status FROM aaelink.user_status WHERE user_id = u.id), 'offline'
           ) AS account_status,
           COALESCE(u.status_text, '') AS status_text,
           COALESCE(u.status_emoji, '') AS status_emoji
    FROM aaelink.users u
    WHERE 1=1
  `
  const params: unknown[] = []

  if (grantWorkspace) {
    params.push(grantWorkspace)
    query += ` AND EXISTS (
      SELECT 1 FROM aaelink.workspace_members wm
      WHERE wm.user_id = u.id AND wm.workspace_id = $${params.length}
    )`
  }

  if (search) {
    params.push(`%${search}%`)
    query += ` AND (u.first_name ILIKE $${params.length} OR u.last_name ILIKE $${params.length}
               OR u.email ILIKE $${params.length} OR u.username ILIKE $${params.length})`
  }

  if (role) {
    params.push(role)
    query += ` AND u.platform_role = $${params.length}`
  }

  if (status) {
    params.push(status)
    query += ` AND COALESCE((SELECT status FROM aaelink.user_status WHERE user_id = u.id), 'offline') = $${params.length}`
  }

  if (departmentId) {
    params.push(departmentId)
    query += ` AND u.department = $${params.length}`
  }

  if (!includeBots) {
    query += ` AND u.platform_role != 'bot'`
  }

  if (cursor) {
    params.push(cursor)
    query += ` AND u.id > $${params.length}`
  }

  query += ` ORDER BY TRIM(CONCAT_WS(' ', u.first_name, u.last_name)) ASC LIMIT $${params.length + 1}`
  params.push(limit + 1)

  const { rows } = await pool.query(query, params)
  const hasMore = rows.length > limit
  const rawMembers = rows.slice(0, limit)

  const blocked = await filterSearchBlocked(pool, uid, rawMembers.map((r: { id: string }) => r.id))

  const members = rawMembers.filter((r: { id: string }) => !blocked.has(r.id)).map(r => {
    return {
      id: r.id,
      email: r.email,
      display_name: r.display_name || '',
      real_name: r.display_name || '',
      role: r.platform_role,
      avatar_url: r.avatar_url || '',
      account_status: r.account_status || 'offline',
      department: r.department || '',
      department_id: '',
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
