import { NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { getAdminSession } from '@/lib/auth/adminAuth'
import { isSuperAdmin } from '@/lib/comms/platformRole'
import { verifyCsrf } from '@/lib/auth/csrf'
import { setUserActive } from '@/lib/auth/userDeactivation'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { emitUserDeactivated } from '@/lib/webhooks/webhookEmitter'

/**
 * POST /api/admin/users/deactivate — deactivate or reactivate a user.
 *
 * Body: { user_id: string, active: boolean }
 *   active = false → deactivate (soft-delete via scim_active=false + revoke sessions)
 *   active = true  → reactivate
 *
 * Converges with SCIM (app/api/scim/v2/Users) on the scim_active flag and the
 * session-revocation side effect, so a user deactivated by either path is
 * blocked at login (app/api/auth/login checks scim_active) and forced out.
 *
 * Platform-admin gated, CSRF on the mutation, audited
 * (user.deactivate / user.reactivate). Guards: cannot deactivate yourself;
 * cannot deactivate a super_admin unless the caller is a super_admin.
 */
async function _POST(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()

  const csrf = await verifyCsrf(req)
  if (csrf) return csrf

  const adm = await getAdminSession(pool)
  if (!adm) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as { user_id?: string; active?: unknown }
  const userId = String(body.user_id || '').trim()
  if (!userId) return NextResponse.json({ error: 'user_id_required' }, { status: 400 })
  if (typeof body.active !== 'boolean') {
    return NextResponse.json({ error: 'active_required' }, { status: 400 })
  }
  const active = body.active

  // Cannot deactivate yourself.
  if (!active && userId === adm.userId) {
    return NextResponse.json({ error: 'cannot_deactivate_self' }, { status: 409 })
  }

  const { rows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`,
    [userId]
  )
  if (!rows[0]) return NextResponse.json({ error: 'user_not_found' }, { status: 404 })

  // Only a super_admin may deactivate another super_admin.
  if (!active && isSuperAdmin(rows[0].platform_role) && !isSuperAdmin(adm.platformRole)) {
    return NextResponse.json({ error: 'forbidden_target' }, { status: 403 })
  }

  const result = await setUserActive(pool, userId, active)
  if (!result.found) return NextResponse.json({ error: 'user_not_found' }, { status: 404 })

  writeAuditLog({
    pool,
    actorId: adm.userId,
    actorRole: adm.platformRole,
    action: active ? 'user.reactivate' : 'user.deactivate',
    resourceKind: 'user',
    resourceId: userId,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
    metadata: { active, sessions_revoked: result.sessionsRevoked },
  })

  // Fan out user.deactivated to outgoing webhooks + Events-API subscriptions
  // only on a real deactivation (reactivation is a different lifecycle event and
  // out of scope here). Best-effort: never block the admin mutation.
  if (!active) {
    try {
      await emitUserDeactivated(pool, { user_id: userId, active, actor_id: adm.userId })
    } catch (e) { console.error('emitUserDeactivated', e) }
  }

  return NextResponse.json({ ok: true, user_id: userId, active, sessions_revoked: result.sessionsRevoked })
}

// ── Traced export ───────────────────────────────────────────────────
export const POST = tracedRoute('POST', '/api/admin/users/deactivate', _POST)
