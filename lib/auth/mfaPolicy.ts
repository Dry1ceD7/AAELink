import type { Pool } from 'pg'

/**
 * D2 Identity — MFA enforcement policy (org/workspace).
 *
 * Enrollment, verification, and the admin policy already existed but nothing
 * enforced the policy: login ignored it. This is the single source of truth for
 * the policy plus the decision logic login uses to gate sign-in.
 *
 * Enforcement is staged, not abrupt: an account gets grace_period_days from
 * creation to enroll. Past grace, a user the policy covers but who has no active
 * MFA factor is blocked at login (mfaEnrollmentRequired). The default policy is
 * 'optional', so enforcement is opt-in and adds no regression.
 *
 * Note: this enforces ENROLLMENT, not a second factor at login — the TOTP verify
 * path is not yet a real time-based check, so demanding a code at login would be
 * security theater. Enrollment enforcement is the honest, testable slice.
 */

export type MfaEnforcement = 'optional' | 'required' | 'required_for_admins'

export interface MfaPolicy {
  enforcement: MfaEnforcement
  grace_period_days: number
  allowed_methods: string[]
  remember_device_days: number
  require_on_password_change: boolean
}

export const DEFAULT_MFA_POLICY: MfaPolicy = {
  enforcement: 'optional',
  grace_period_days: 14,
  allowed_methods: ['totp', 'backup_codes', 'sso_mfa'],
  remember_device_days: 30,
  require_on_password_change: true,
}

// ── Pure decision helper ─────────────────────────────────────────────

const DAY_MS = 86_400_000

/**
 * Whether a user must have an active MFA factor to sign in, given the policy and
 * their account context. Returns false during the grace window so new accounts
 * can still log in to enroll.
 */
export function mfaEnrollmentRequired(
  policy: MfaPolicy,
  ctx: { isAdmin: boolean; accountAgeMs: number }
): boolean {
  if (policy.enforcement === 'optional') return false
  if (policy.enforcement === 'required_for_admins' && !ctx.isAdmin) return false
  // 'required', or 'required_for_admins' and the user is an admin.
  const graceMs = Math.max(0, policy.grace_period_days) * DAY_MS
  return ctx.accountAgeMs >= graceMs
}

// ── Enrollment lookup ────────────────────────────────────────────────

/** True when the user has at least one active MFA enrollment. */
export async function userHasActiveMfa(pool: Pool, userId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM aaelink.mfa_enrollments WHERE user_id = $1 AND is_active = true LIMIT 1`,
    [userId]
  )
  return rows.length > 0
}

// ── Validation ───────────────────────────────────────────────────────

export function validateMfaPatch(patch: Partial<MfaPolicy>): { field: string; message: string } | null {
  if (patch.enforcement !== undefined &&
      !['optional', 'required', 'required_for_admins'].includes(patch.enforcement)) {
    return { field: 'enforcement', message: 'invalid (optional|required|required_for_admins)' }
  }
  if (patch.grace_period_days !== undefined &&
      (typeof patch.grace_period_days !== 'number' || patch.grace_period_days < 0 || patch.grace_period_days > 365)) {
    return { field: 'grace_period_days', message: 'out_of_range (0-365)' }
  }
  if (patch.remember_device_days !== undefined &&
      (typeof patch.remember_device_days !== 'number' || patch.remember_device_days < 0 || patch.remember_device_days > 365)) {
    return { field: 'remember_device_days', message: 'out_of_range (0-365)' }
  }
  return null
}

// ── DB-backed read/write with a short in-process cache ───────────────

const CONFIG_KEY = 'mfa_policy'
const CACHE_TTL_MS = 30_000
let cache: { policy: MfaPolicy; at: number } | null = null

function parsePolicy(value: string | undefined): MfaPolicy {
  if (!value) return { ...DEFAULT_MFA_POLICY }
  try {
    return { ...DEFAULT_MFA_POLICY, ...(JSON.parse(value) as Partial<MfaPolicy>) }
  } catch {
    return { ...DEFAULT_MFA_POLICY }
  }
}

/** Current MFA policy (defaults merged over stored overrides). Cached for the hot login path. */
export async function getMfaPolicy(pool: Pool, now = Date.now()): Promise<MfaPolicy> {
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.policy
  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = $1`, [CONFIG_KEY]
  )
  const policy = parsePolicy(rows[0]?.value)
  cache = { policy, at: now }
  return policy
}

/** Drop the cached policy so the next read reloads from the DB. */
export function invalidateMfaPolicyCache(): void {
  cache = null
}

/** Merge a validated patch into the policy and persist it. Throws on a bad value. */
export async function updateMfaPolicy(pool: Pool, patch: Partial<MfaPolicy>, now = Date.now()): Promise<MfaPolicy> {
  const violation = validateMfaPatch(patch)
  if (violation) throw new Error(`${violation.field}: ${violation.message}`)

  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = $1`, [CONFIG_KEY]
  )
  const updated: MfaPolicy = { ...parsePolicy(rows[0]?.value), ...patch }
  await pool.query(
    `INSERT INTO aaelink.system_config (key, value, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3`,
    [CONFIG_KEY, JSON.stringify(updated), now]
  )
  cache = { policy: updated, at: now }
  return updated
}
