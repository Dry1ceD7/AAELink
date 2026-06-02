// keep: enterprise admin surface kept for parity (intentional, not yet wired into UI)
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Session Policy API — configurable session length and "remember me" policies.
 *
 * GET  /api/admin/session-policy — get current session configuration
 * PUT  /api/admin/session-policy — update session configuration (admin only)
 *
 * Controls:
 *   - Default session TTL (e.g., 24h for web, 30d for desktop)
 *   - "Remember me" extended TTL (e.g., 30d)
 *   - Maximum session count per user
 *   - Idle timeout
 *   - Force re-auth interval for sensitive actions
 *   - Session persistence mode (cookie, localStorage, secure storage)
 */

const DEFAULT_POLICY = {
  web_session_ttl_hours: 24,
  desktop_session_ttl_hours: 720, // 30 days
  mobile_session_ttl_hours: 720,
  remember_me_ttl_hours: 720,
  remember_me_enabled: true,
  max_sessions_per_user: 10,
  idle_timeout_minutes: 60,
  force_reauth_hours: 168, // 7 days for sensitive actions
  require_mfa_for_admin: false,
  session_persistence: 'cookie' as string, // 'cookie' | 'secure_storage'
  revoke_on_password_change: true,
  single_session_mode: false,
}

async function _GET() {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Admin check
  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Fetch stored policy (or return defaults)
  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = 'session_policy'`
  )

  let policy = { ...DEFAULT_POLICY }
  if (rows[0]?.value) {
    try {
      const stored = JSON.parse(rows[0].value)
      policy = { ...DEFAULT_POLICY, ...stored }
    } catch { /* use defaults */ }
  }

  return NextResponse.json({ policy })
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
  if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as Partial<typeof DEFAULT_POLICY>

  // Validate ranges
  if (body.web_session_ttl_hours !== undefined && (body.web_session_ttl_hours < 1 || body.web_session_ttl_hours > 8760)) {
    return NextResponse.json({ error: 'web_session_ttl_out_of_range (1-8760h)' }, { status: 400 })
  }
  if (body.max_sessions_per_user !== undefined && (body.max_sessions_per_user < 1 || body.max_sessions_per_user > 100)) {
    return NextResponse.json({ error: 'max_sessions_out_of_range (1-100)' }, { status: 400 })
  }
  if (body.idle_timeout_minutes !== undefined && (body.idle_timeout_minutes < 5 || body.idle_timeout_minutes > 10080)) {
    return NextResponse.json({ error: 'idle_timeout_out_of_range (5-10080m)' }, { status: 400 })
  }

  // Merge with existing
  const { rows: existing } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = 'session_policy'`
  )
  let current = { ...DEFAULT_POLICY }
  if (existing[0]?.value) {
    try { current = { ...current, ...JSON.parse(existing[0].value) } } catch { /**/ }
  }

  const updated = { ...current, ...body }
  const now = Date.now()

  await pool.query(`
    INSERT INTO aaelink.system_config (key, value, updated_at)
    VALUES ('session_policy', $1, $2)
    ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = $2
  `, [JSON.stringify(updated), now])

  // Audit log
  await pool.query(`
    INSERT INTO aaelink.audit_log (id, actor_id, action, target_type, meta, created_at)
    VALUES ($1, $2, 'session_policy_updated', 'system', $3, $4)
  `, [(await import('crypto')).randomUUID(), uid, JSON.stringify({ changes: body }), now])

  return NextResponse.json({ policy: updated, updated_at: now })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/admin/session-policy', _GET)
export const PUT    = tracedRoute('PUT', '/api/admin/session-policy', _PUT)
