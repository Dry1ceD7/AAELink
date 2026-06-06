import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { tracedRoute } from '@/lib/api/tracedRoute'
import {
  getPasswordPolicy,
  updatePasswordPolicy,
  validatePolicyPatch,
  type PasswordPolicy,
} from '@/lib/auth/passwordPolicy'

/**
 * Password Policy API — admin-configurable complexity / history / rotation rules.
 *
 * GET /api/admin/password-policy — get the effective policy (platform-admin only)
 * PUT /api/admin/password-policy — update the policy (platform-admin only, CSRF, audited)
 *
 * The stored policy actually drives behavior: register, change-password, and admin
 * user-create/reset enforce it via lib/auth/passwordPolicy.validatePassword.
 */

async function requireAdmin(): Promise<string | NextResponse> {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { rows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!isPlatformAdmin(rows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  return uid
}

async function _GET() {
  const guard = await requireAdmin()
  if (guard instanceof NextResponse) return guard
  const policy = await getPasswordPolicy(getPool()!)
  return NextResponse.json({ policy })
}

async function _PUT(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  const guard = await requireAdmin()
  if (guard instanceof NextResponse) return guard
  const uid = guard
  const pool = getPool()!

  const body = (await req.json().catch(() => ({}))) as Partial<PasswordPolicy>
  const violation = validatePolicyPatch(body)
  if (violation) {
    return NextResponse.json({ error: `${violation.field}_${violation.message}` }, { status: 400 })
  }

  const now = Date.now()
  const updated = await updatePasswordPolicy(pool, body, now)

  writeAuditLog({
    pool,
    actorId: uid,
    action: 'password_policy.update',
    resourceKind: 'system',
    resourceId: 'password_policy',
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
    metadata: { changes: body },
  })

  return NextResponse.json({ policy: updated, updated_at: now })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/admin/password-policy', _GET)
export const PUT    = tracedRoute('PUT', '/api/admin/password-policy', _PUT)
