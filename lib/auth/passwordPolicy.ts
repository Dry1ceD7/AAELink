import type { Pool } from 'pg'

/**
 * Identity parity — admin-configurable password policy (Slack/Mattermost Grid).
 *
 * The audit (2026-06-03-identity §27) flagged that AAELink enforced only an
 * 8-char minimum with no admin policy, history, or rotation. This is the single
 * source of truth for the policy shape, a pure `validatePassword` matrix, and the
 * DB-backed read/write (stored in `aaelink.system_config` under 'password_policy',
 * mirroring `mfaPolicy`/`sessionPolicy`).
 *
 * Defaults are intentionally permissive so enabling the feature never locks
 * existing users out: min_length 8, every complexity rule OFF, no rotation, no
 * history. An admin opts INTO stricter rules.
 */

export interface PasswordPolicy {
  min_length: number
  require_upper: boolean
  require_lower: boolean
  require_digit: boolean
  require_symbol: boolean
  disallow_username_email: boolean
  /** Max password age in days; 0 = never expires. */
  max_age_days: number
  /** Number of previous hashes to remember and forbid reuse; 0 = history off. */
  history_count: number
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  min_length: 8,
  require_upper: false,
  require_lower: false,
  require_digit: false,
  require_symbol: false,
  disallow_username_email: false,
  max_age_days: 0,
  history_count: 0,
}

/** Stable machine-readable violation codes returned to clients in `detail`. */
export type PasswordViolation =
  | 'too_short'
  | 'require_upper'
  | 'require_lower'
  | 'require_digit'
  | 'require_symbol'
  | 'contains_username'
  | 'contains_email'

// ── Pure validator (unit-testable, no DB) ────────────────────────────

/**
 * Validate a candidate password against a policy. Pure: returns the list of
 * failing rule codes (empty ⇒ valid). The `identity` lets the policy forbid a
 * password that contains the user's username / email local-part.
 */
export function validatePassword(
  policy: PasswordPolicy,
  candidate: string,
  identity: { username?: string; email?: string } = {}
): PasswordViolation[] {
  const codes: PasswordViolation[] = []
  const pw = String(candidate ?? '')

  if (pw.length < Math.max(1, policy.min_length)) codes.push('too_short')
  if (policy.require_upper && !/[A-Z]/.test(pw)) codes.push('require_upper')
  if (policy.require_lower && !/[a-z]/.test(pw)) codes.push('require_lower')
  if (policy.require_digit && !/[0-9]/.test(pw)) codes.push('require_digit')
  // Symbol = any non-alphanumeric, non-whitespace character.
  if (policy.require_symbol && !/[^A-Za-z0-9\s]/.test(pw)) codes.push('require_symbol')

  if (policy.disallow_username_email) {
    const lower = pw.toLowerCase()
    const username = String(identity.username ?? '').trim().toLowerCase()
    if (username.length >= 3 && lower.includes(username)) codes.push('contains_username')
    const email = String(identity.email ?? '').trim().toLowerCase()
    const local = email.split('@')[0] ?? ''
    if (local.length >= 3 && lower.includes(local)) codes.push('contains_email')
  }

  return codes
}

// ── Validation of a policy PATCH (admin route) ───────────────────────

export function validatePolicyPatch(patch: Partial<PasswordPolicy>): { field: string; message: string } | null {
  if (patch.min_length !== undefined &&
      (typeof patch.min_length !== 'number' || patch.min_length < 1 || patch.min_length > 256)) {
    return { field: 'min_length', message: 'out_of_range (1-256)' }
  }
  if (patch.max_age_days !== undefined &&
      (typeof patch.max_age_days !== 'number' || patch.max_age_days < 0 || patch.max_age_days > 3650)) {
    return { field: 'max_age_days', message: 'out_of_range (0-3650)' }
  }
  if (patch.history_count !== undefined &&
      (typeof patch.history_count !== 'number' || patch.history_count < 0 || patch.history_count > 50)) {
    return { field: 'history_count', message: 'out_of_range (0-50)' }
  }
  for (const k of ['require_upper', 'require_lower', 'require_digit', 'require_symbol', 'disallow_username_email'] as const) {
    if (patch[k] !== undefined && typeof patch[k] !== 'boolean') {
      return { field: k, message: 'must_be_boolean' }
    }
  }
  return null
}

// ── DB-backed read/write with a short in-process cache ───────────────

const CONFIG_KEY = 'password_policy'
const CACHE_TTL_MS = 30_000
let cache: { policy: PasswordPolicy; at: number } | null = null

function parsePolicy(value: string | undefined): PasswordPolicy {
  if (!value) return { ...DEFAULT_PASSWORD_POLICY }
  try {
    return { ...DEFAULT_PASSWORD_POLICY, ...(JSON.parse(value) as Partial<PasswordPolicy>) }
  } catch {
    return { ...DEFAULT_PASSWORD_POLICY }
  }
}

/** Current password policy (defaults merged over stored overrides). Cached for hot paths. */
export async function getPasswordPolicy(pool: Pool, now = Date.now()): Promise<PasswordPolicy> {
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.policy
  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = $1`, [CONFIG_KEY]
  )
  const policy = parsePolicy(rows[0]?.value)
  cache = { policy, at: now }
  return policy
}

/** Drop the cached policy so the next read reloads from the DB. */
export function invalidatePasswordPolicyCache(): void {
  cache = null
}

/** Merge a validated patch into the policy and persist it. Throws on a bad value. */
export async function updatePasswordPolicy(pool: Pool, patch: Partial<PasswordPolicy>, now = Date.now()): Promise<PasswordPolicy> {
  const violation = validatePolicyPatch(patch)
  if (violation) throw new Error(`${violation.field}: ${violation.message}`)

  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = $1`, [CONFIG_KEY]
  )
  const updated: PasswordPolicy = { ...parsePolicy(rows[0]?.value), ...patch }
  await pool.query(
    `INSERT INTO aaelink.system_config (key, value, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3`,
    [CONFIG_KEY, JSON.stringify(updated), now]
  )
  cache = { policy: updated, at: now }
  return updated
}

// ── Password history (reuse prevention) ──────────────────────────────

/**
 * True when `candidate` matches one of the last `history_count` stored hashes for
 * the user (including the user's current hash). No-op (false) when history is off.
 * `verify` is injected so this stays decoupled from the hashing implementation.
 */
export async function isPasswordReused(
  pool: Pool,
  userId: string,
  candidate: string,
  policy: PasswordPolicy,
  verify: (plain: string, stored: string) => boolean
): Promise<boolean> {
  if (policy.history_count <= 0) return false

  // Current hash counts as the most recent entry.
  const { rows: cur } = await pool.query<{ password_hash: string }>(
    `SELECT password_hash FROM aaelink.users WHERE id = $1`, [userId]
  )
  const hashes: string[] = []
  if (cur[0]?.password_hash) hashes.push(cur[0].password_hash)

  const { rows: hist } = await pool.query<{ hash: string }>(
    `SELECT hash FROM aaelink.password_history
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, policy.history_count]
  )
  for (const h of hist) hashes.push(h.hash)

  for (const stored of hashes.slice(0, policy.history_count)) {
    if (verify(candidate, stored)) return true
  }
  return false
}

/**
 * Record a hash in the user's password history and trim entries beyond the
 * retained window. Call AFTER a successful password change/set. Safe to call with
 * history off (it still records, so turning history on later has a trail).
 */
export async function recordPasswordHistory(
  pool: Pool,
  userId: string,
  hash: string,
  policy: PasswordPolicy,
  now = Date.now()
): Promise<void> {
  const { randomUUID } = await import('crypto')
  await pool.query(
    `INSERT INTO aaelink.password_history (id, user_id, hash, created_at)
     VALUES ($1, $2, $3, $4)`,
    [randomUUID(), userId, hash, now]
  )
  // Keep at most max(history_count, 1) rows so the table never grows unbounded.
  const keep = Math.max(policy.history_count, 1)
  await pool.query(
    `DELETE FROM aaelink.password_history
      WHERE user_id = $1
        AND id NOT IN (
          SELECT id FROM aaelink.password_history
           WHERE user_id = $1
           ORDER BY created_at DESC
           LIMIT $2
        )`,
    [userId, keep]
  )
}

// ── Password expiry (rotation) ───────────────────────────────────────

/**
 * Whether a password is past its max age and must be changed. Pure. `changedAt`
 * is epoch-ms (users.password_changed_at); 0/undefined ⇒ never (treated as not
 * expired so legacy accounts are not abruptly locked until they next change).
 */
export function isPasswordExpired(policy: PasswordPolicy, changedAt: number | null | undefined, now = Date.now()): boolean {
  if (policy.max_age_days <= 0) return false
  const stamped = Number(changedAt || 0)
  if (stamped <= 0) return false
  const ageMs = now - stamped
  return ageMs >= policy.max_age_days * 86_400_000
}
