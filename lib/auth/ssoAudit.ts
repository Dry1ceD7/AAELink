import type { Pool } from 'pg'
import { writeAuditLog } from '@/lib/enterprise/auditLog'

/**
 * Audit helpers for inbound SSO. Every login attempt — success or failure —
 * is recorded so platform admins have a tamper-evident trail. Failures never
 * include the failure-distinguishing detail in the user-facing response, but
 * DO record a coarse reason here for operators.
 */

export function auditSsoSuccess(
  pool: Pool,
  args: { userId: string; providerId: string; protocol: string; provisioned: boolean; ip: string; userAgent: string }
): void {
  writeAuditLog({
    pool,
    actorId: args.userId,
    action: 'user.login_sso',
    resourceKind: 'sso_provider',
    resourceId: args.providerId,
    ipAddress: args.ip,
    userAgent: args.userAgent,
    metadata: { protocol: args.protocol, provisioned: args.provisioned },
  })
}

export function auditSsoFailure(
  pool: Pool,
  args: { providerId: string; protocol: string; reason: string; ip: string; userAgent: string }
): void {
  writeAuditLog({
    pool,
    actorId: 'unknown',
    action: 'user.login_sso_failed',
    resourceKind: 'sso_provider',
    resourceId: args.providerId || 'unknown',
    ipAddress: args.ip,
    userAgent: args.userAgent,
    metadata: { protocol: args.protocol, reason: args.reason },
  })
}
