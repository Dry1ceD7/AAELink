import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * App Approval Policies API — manage which integrations/bots are allowed.
 *
 * GET  /api/admin/app-policies — get approval policy + pending apps
 * PUT  /api/admin/app-policies — update approval policy
 * POST /api/admin/app-policies — approve or reject a pending app
 *
 * Policy modes:
 *   - 'open'      — any admin can install apps
 *   - 'approval'  — apps require super_admin approval before activation
 *   - 'locked'    — no new apps allowed (enterprise lockdown)
 *
 * Integrates with bot_users table for approval workflow.
 */
async function _GET() {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Get policy config
  const { rows: cfgRows } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = 'app_approval_policy'`
  )

  const defaultPolicy = {
    mode: 'approval' as string,
    require_https_endpoints: true,
    max_apps_per_workspace: 50,
    blocked_scopes: [] as string[],
    auto_approve_internal: false,
  }

  let policy = defaultPolicy
  if (cfgRows[0]?.value) {
    try { policy = { ...defaultPolicy, ...JSON.parse(cfgRows[0].value) } } catch { /**/ }
  }

  // List pending apps
  const { rows: pending } = await pool.query(`
    SELECT id, kind, name, description, scopes, status, created_by, created_at
    FROM aaelink.bot_users
    WHERE status = 'pending_approval'
    ORDER BY created_at ASC
  `)

  // List active apps count
  const { rows: [counts] } = await pool.query<{
    active: string; pending: string; rejected: string; total: string
  }>(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'active')::text AS active,
      COUNT(*) FILTER (WHERE status = 'pending_approval')::text AS pending,
      COUNT(*) FILTER (WHERE status = 'rejected')::text AS rejected,
      COUNT(*)::text AS total
    FROM aaelink.bot_users
  `)

  return NextResponse.json({
    policy,
    pending_apps: pending.map(p => ({ ...p, created_at: Number(p.created_at) })),
    counts: {
      active: Number(counts.active),
      pending: Number(counts.pending),
      rejected: Number(counts.rejected),
      total: Number(counts.total),
    }
  })
}

async function _PUT(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (uRows[0]?.platform_role !== 'super_admin') {
    return NextResponse.json({ error: 'super_admin_only' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    mode?: string; require_https_endpoints?: boolean
    max_apps_per_workspace?: number; blocked_scopes?: string[]
    auto_approve_internal?: boolean
  }

  if (body.mode && !['open', 'approval', 'locked'].includes(body.mode)) {
    return NextResponse.json({ error: 'invalid_mode (open|approval|locked)' }, { status: 400 })
  }

  const { rows: existing } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = 'app_approval_policy'`
  )
  let current: Record<string, unknown> = {}
  if (existing[0]?.value) { try { current = JSON.parse(existing[0].value) } catch { /**/ } }

  const updated = { ...current, ...body }
  const now = Date.now()

  await pool.query(`
    INSERT INTO aaelink.system_config (key, value, updated_at)
    VALUES ('app_approval_policy', $1, $2)
    ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = $2
  `, [JSON.stringify(updated), now])

  return NextResponse.json({ policy: updated, updated_at: now })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    app_id?: string; action?: 'approve' | 'reject'; reason?: string
  }

  const appId = String(body.app_id || '').trim()
  if (!appId) return NextResponse.json({ error: 'app_id_required' }, { status: 400 })
  if (!body.action || !['approve', 'reject'].includes(body.action)) {
    return NextResponse.json({ error: 'action_required (approve|reject)' }, { status: 400 })
  }

  const newStatus = body.action === 'approve' ? 'active' : 'rejected'
  const { rowCount } = await pool.query(
    `UPDATE aaelink.bot_users SET status = $1 WHERE id = $2 AND status = 'pending_approval'`,
    [newStatus, appId]
  )
  if (!rowCount) return NextResponse.json({ error: 'app_not_found_or_not_pending' }, { status: 404 })

  // Audit
  await pool.query(`
    INSERT INTO aaelink.audit_log (id, actor_id, action, target_type, target_id, meta, created_at)
    VALUES ($1, $2, $3, 'bot_user', $4, $5, $6)
  `, [
    randomUUID(), uid, `app_${body.action}d`, appId,
    JSON.stringify({ reason: body.reason || '' }), Date.now()
  ])

  return NextResponse.json({ ok: true, app_id: appId, new_status: newStatus })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/admin/app-policies', _GET)
export const POST   = tracedRoute('POST', '/api/admin/app-policies', _POST)
export const PUT    = tracedRoute('PUT', '/api/admin/app-policies', _PUT)
