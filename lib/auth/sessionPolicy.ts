import type { Pool } from 'pg'

/**
 * D2 Identity — application-enforced session duration policy.
 *
 * Slack lets an org cap session length and idle time rather than relying on the
 * IdP. The policy lives in system_config under the `session_policy` key and is
 * read here; the pure helpers (sessionTtlMs, isIdleExpired) turn it into the TTL
 * login stamps onto a session and the idle gate readSessionUserId enforces.
 *
 * Defaults preserve the prior hardcoded behavior (30-day sessions, idle disabled)
 * so enabling this layer is purely additive — an admin opts into tighter limits.
 */

export type SessionPersistence = 'cookie' | 'secure_storage'
export type SessionDevice = 'web' | 'desktop' | 'mobile'

export interface SessionPolicy {
  web_session_ttl_hours: number
  desktop_session_ttl_hours: number
  mobile_session_ttl_hours: number
  remember_me_ttl_hours: number
  remember_me_enabled: boolean
  max_sessions_per_user: number
  idle_timeout_minutes: number
  /** Idle expiry is enforced only when this is true (default off — no surprise logouts). */
  idle_timeout_enabled: boolean
  force_reauth_hours: number
  require_mfa_for_admin: boolean
  session_persistence: SessionPersistence
  revoke_on_password_change: boolean
  single_session_mode: boolean
}

/** 30 days — matches the prior hardcoded SESSION_MS in app/api/auth/login. */
const THIRTY_DAYS_HOURS = 720

export const DEFAULT_SESSION_POLICY: SessionPolicy = {
  web_session_ttl_hours: THIRTY_DAYS_HOURS,
  desktop_session_ttl_hours: THIRTY_DAYS_HOURS,
  mobile_session_ttl_hours: THIRTY_DAYS_HOURS,
  remember_me_ttl_hours: THIRTY_DAYS_HOURS,
  remember_me_enabled: true,
  max_sessions_per_user: 10,
  idle_timeout_minutes: 60,
  idle_timeout_enabled: false,
  force_reauth_hours: 168,
  require_mfa_for_admin: false,
  session_persistence: 'cookie',
  revoke_on_password_change: true,
  single_session_mode: false,
}

// ── Pure helpers (no DB — directly unit-testable) ────────────────────

/** Session lifetime in ms for a device class, from the policy's TTL hours. */
export function sessionTtlMs(policy: SessionPolicy, device: SessionDevice = 'web'): number {
  const hours =
    device === 'desktop' ? policy.desktop_session_ttl_hours
    : device === 'mobile' ? policy.mobile_session_ttl_hours
    : policy.web_session_ttl_hours
  return Math.max(1, hours) * 3600_000
}

/**
 * Whether a session has gone idle past the policy limit. Returns false when idle
 * enforcement is disabled. A lastActiveAt of 0 (never touched) falls back to
 * createdAt so a fresh session is never treated as already idle.
 */
export function isIdleExpired(
  policy: SessionPolicy,
  lastActiveAt: number,
  now: number,
  createdAt = 0
): boolean {
  if (!policy.idle_timeout_enabled || policy.idle_timeout_minutes <= 0) return false
  const ref = lastActiveAt > 0 ? lastActiveAt : createdAt
  if (ref <= 0) return false
  return now - ref > policy.idle_timeout_minutes * 60_000
}

// ── Validation ───────────────────────────────────────────────────────

export type PolicyValidationError = { field: string; message: string }

/** Range-check a partial policy patch. Returns the first violation, or null. */
export function validatePolicyPatch(patch: Partial<SessionPolicy>): PolicyValidationError | null {
  const ttlFields: (keyof SessionPolicy)[] = [
    'web_session_ttl_hours', 'desktop_session_ttl_hours',
    'mobile_session_ttl_hours', 'remember_me_ttl_hours',
  ]
  for (const f of ttlFields) {
    const v = patch[f] as number | undefined
    if (v !== undefined && (typeof v !== 'number' || v < 1 || v > 8760)) {
      return { field: f, message: 'ttl_out_of_range (1-8760h)' }
    }
  }
  if (patch.max_sessions_per_user !== undefined &&
      (patch.max_sessions_per_user < 1 || patch.max_sessions_per_user > 100)) {
    return { field: 'max_sessions_per_user', message: 'out_of_range (1-100)' }
  }
  if (patch.idle_timeout_minutes !== undefined &&
      (patch.idle_timeout_minutes < 5 || patch.idle_timeout_minutes > 10080)) {
    return { field: 'idle_timeout_minutes', message: 'out_of_range (5-10080m)' }
  }
  return null
}

// ── DB-backed read/write with a short in-process cache ───────────────

const CONFIG_KEY = 'session_policy'
const CACHE_TTL_MS = 30_000
let cache: { policy: SessionPolicy; at: number } | null = null

function parsePolicy(value: string | undefined): SessionPolicy {
  if (!value) return { ...DEFAULT_SESSION_POLICY }
  try {
    return { ...DEFAULT_SESSION_POLICY, ...(JSON.parse(value) as Partial<SessionPolicy>) }
  } catch {
    return { ...DEFAULT_SESSION_POLICY }
  }
}

/**
 * Current session policy (defaults merged over any stored overrides). Cached
 * in-process for {@link CACHE_TTL_MS} so the hot auth path does not hit the DB on
 * every request.
 */
export async function getSessionPolicy(pool: Pool, now = Date.now()): Promise<SessionPolicy> {
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.policy
  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = $1`, [CONFIG_KEY]
  )
  const policy = parsePolicy(rows[0]?.value)
  cache = { policy, at: now }
  return policy
}

/** Drop the cached policy so the next read reloads from the DB. */
export function invalidateSessionPolicyCache(): void {
  cache = null
}

/**
 * Merge a validated patch into the stored policy and persist it. Throws on an
 * out-of-range value (caller maps to a 400). Returns the new effective policy.
 */
export async function updateSessionPolicy(
  pool: Pool,
  patch: Partial<SessionPolicy>,
  now = Date.now()
): Promise<SessionPolicy> {
  const violation = validatePolicyPatch(patch)
  if (violation) throw new Error(`${violation.field}: ${violation.message}`)

  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = $1`, [CONFIG_KEY]
  )
  const current = parsePolicy(rows[0]?.value)
  const updated: SessionPolicy = { ...current, ...patch }

  await pool.query(
    `INSERT INTO aaelink.system_config (key, value, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3`,
    [CONFIG_KEY, JSON.stringify(updated), now]
  )
  cache = { policy: updated, at: now }
  return updated
}
