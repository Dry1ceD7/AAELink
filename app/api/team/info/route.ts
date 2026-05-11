import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Team / Workspace Info API — Slack team.info / team.accessLogs parity.
 *
 * GET /api/team/info — workspace-level metadata + settings
 *   ?team_id= — optional workspace ID (default: user's current workspace)
 *   ?view=info — workspace info (default)
 *   ?view=access_logs — recent access log entries
 *   ?view=billing — billing/plan info
 *   ?view=integration_logs — integration activity logs
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const view = req.nextUrl.searchParams.get('view') || 'info'
  const teamId = req.nextUrl.searchParams.get('team_id') || ''

  // Get user's workspace
  const { rows: userRows } = await pool.query<{ workspace_id: string; platform_role: string }>(
    `SELECT workspace_id, platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  const workspaceId = teamId || userRows[0]?.workspace_id || ''

  if (view === 'info') {
    const { rows } = await pool.query<{
      id: string; name: string; domain: string; email_domain: string;
      icon_url: string; description: string; plan: string; created_at: number;
    }>(
      `SELECT * FROM aaelink.workspaces WHERE id = $1`, [workspaceId]
    )
    if (!rows[0]) return NextResponse.json({ error: 'team_not_found' }, { status: 404 })

    const ws = rows[0]

    // Stats
    const { rows: [stats] } = await pool.query<{
      total_users: string; active_users: string; total_channels: string;
      total_messages: string; total_files: string
    }>(`
      SELECT
        (SELECT COUNT(*)::text FROM aaelink.users WHERE workspace_id = $1) AS total_users,
        (SELECT COUNT(*)::text FROM aaelink.users WHERE workspace_id = $1 AND status = 'active') AS active_users,
        (SELECT COUNT(*)::text FROM aaelink.channels WHERE workspace_id = $1) AS total_channels,
        (SELECT COUNT(*)::text FROM aaelink.messages m
         JOIN aaelink.channels c ON c.id = m.channel_id
         WHERE c.workspace_id = $1) AS total_messages,
        (SELECT COUNT(*)::text FROM aaelink.files) AS total_files
    `, [workspaceId])

    return NextResponse.json({
      team: {
        id: ws.id,
        name: ws.name,
        domain: ws.domain || `${String(ws.name || '').toLowerCase().replace(/\s+/g, '-')}.aaelink.local`,
        email_domain: ws.email_domain || '',
        icon: ws.icon_url || '',
        description: ws.description || '',
        plan: ws.plan || 'enterprise',
        created_at: ws.created_at,
        stats: {
          total_users: Number(stats?.total_users || 0),
          active_users: Number(stats?.active_users || 0),
          total_channels: Number(stats?.total_channels || 0),
          total_messages: Number(stats?.total_messages || 0),
          total_files: Number(stats?.total_files || 0),
        },
      },
    })
  }

  if (view === 'access_logs') {
    // Admin only
    if (!['super_admin', 'platform_admin'].includes(userRows[0]?.platform_role || '')) {
      return NextResponse.json({ error: 'admin_only' }, { status: 403 })
    }

    const limit = Math.min(Number(req.nextUrl.searchParams.get('count') || 100), 500)
    const page = Math.max(Number(req.nextUrl.searchParams.get('page') || 1), 1)
    const before = req.nextUrl.searchParams.get('before') || ''

    let query = `
      SELECT s.id, s.user_id, s.created_at, s.device_type, s.user_agent, s.ip_address,
             u.display_name, u.email
      FROM aaelink.sessions s
      JOIN aaelink.users u ON u.id = s.user_id
      WHERE u.workspace_id = $1
    `
    const params: unknown[] = [workspaceId]

    if (before) {
      params.push(Number(before))
      query += ` AND s.created_at < $${params.length}`
    }

    query += ` ORDER BY s.created_at DESC LIMIT $${params.length + 1}`
    params.push(limit)

    const { rows } = await pool.query<{
      id: string; user_id: string; created_at: number;
      device_type: string; user_agent: string; ip_address: string;
      display_name: string; email: string;
    }>(query, params)
    const logins = rows.map(r => ({
      user_id: r.user_id,
      user_name: r.display_name,
      user_email: r.email,
      date_first: r.created_at,
      date_last: r.created_at,
      count: 1,
      ip: r.ip_address || '',
      user_agent: r.user_agent || '',
      isp: '',
      country: '',
      region: '',
    }))

    return NextResponse.json({ logins, paging: { count: limit, page } })
  }

  if (view === 'integration_logs') {
    if (!['super_admin', 'platform_admin'].includes(userRows[0]?.platform_role || '')) {
      return NextResponse.json({ error: 'admin_only' }, { status: 403 })
    }

    const { rows } = await pool.query(`
      SELECT * FROM aaelink.audit_log
      WHERE action LIKE 'integration.%'
      ORDER BY created_at DESC
      LIMIT 100
    `)

    return NextResponse.json({ logs: rows })
  }

  if (view === 'billing') {
    if (!['super_admin'].includes(userRows[0]?.platform_role || '')) {
      return NextResponse.json({ error: 'admin_only' }, { status: 403 })
    }
    return NextResponse.json({
      plan: {
        plan_id: 'enterprise',
        plan_name: 'AAELink Enterprise',
        is_paid: true,
        features: {
          sso: true, scim: true, dlp: true, legal_hold: true,
          data_residency: true, audit_log: true, custom_retention: true,
          information_barriers: true, ekm: true, compliance_exports: true,
        },
      },
    })
  }

  return NextResponse.json({ error: 'unknown view' }, { status: 400 })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/team/info', _GET)
