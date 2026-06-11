import type { Pool } from 'pg'
import type { SessionPolicy } from '@/lib/auth/sessionPolicy'

/**
 * D2 Identity — enforcement of the session-policy fields that were stored but
 * never read (max_sessions_per_user, single_session_mode, force_reauth_hours,
 * revoke_on_password_change). The policy itself lives in lib/auth/sessionPolicy;
 * this module turns four of its fields into actual behavior at session creation,
 * session validation, and password change.
 *
 * Security posture: these helpers operate on an already-fetched SessionPolicy.
 * Callers must fail-OPEN only when the policy ROW is absent (getSessionPolicy
 * already returns DEFAULT_SESSION_POLICY in that case) — never on a policy-fetch
 * error. For the security-critical stale-auth gate the caller lets a DB error
 * from getSessionPolicy propagate (fail-closed), rather than treating a failed
 * read as "no policy".
 */

/**
 * Whether a session is stale per force_reauth_hours: the user must re-auth once
 * the session is older than N hours since it was created, regardless of activity
 * (idle timeout is a separate, activity-based gate). force_reauth_hours <= 0
 * disables the check. createdAt of 0 (legacy/unstamped) is treated as not stale
 * so a pre-existing session is never force-killed for lacking a timestamp.
 */
export function isAuthStale(
  policy: SessionPolicy,
  createdAt: number,
  now: number
): boolean {
  if (!policy.force_reauth_hours || policy.force_reauth_hours <= 0) return false
  if (!createdAt || createdAt <= 0) return false
  return now - createdAt > policy.force_reauth_hours * 3600_000
}

/**
 * Enforce per-user session caps right after a new session is inserted.
 *
 *  - single_session_mode: keep only the just-created session; revoke all others.
 *  - otherwise cap to max_sessions_per_user: keep the newest N active sessions
 *    (the current one is always among them), evicting the oldest beyond the cap.
 *
 * keepSessionId is the session that must survive (the one just created). Only
 * non-expired sessions are counted toward the cap; expired rows are ignored (a
 * separate sweep removes them). Best-effort: a failure here never blocks login,
 * so callers wrap accordingly.
 */
export async function enforceSessionLimits(
  pool: Pool,
  userId: string,
  policy: SessionPolicy,
  keepSessionId: string,
  now = Date.now()
): Promise<void> {
  if (policy.single_session_mode) {
    await pool.query(
      `DELETE FROM aaelink.sessions WHERE user_id = $1 AND id <> $2`,
      [userId, keepSessionId]
    )
    return
  }

  const cap = Math.max(1, policy.max_sessions_per_user || 1)
  // Evict the oldest active sessions beyond the cap. ORDER BY created_at DESC
  // keeps the newest `cap` rows (the just-created session is the newest), then
  // OFFSET selects everything older than the cap for deletion.
  await pool.query(
    `DELETE FROM aaelink.sessions
      WHERE id IN (
        SELECT id FROM aaelink.sessions
         WHERE user_id = $1 AND expires_at > $2
         ORDER BY created_at DESC, id DESC
         OFFSET $3
      )`,
    [userId, now, cap]
  )
}

/**
 * Revoke every OTHER session for a user, keeping the one passed in. Used by the
 * password-change path when revoke_on_password_change is on so a credential
 * rotation invalidates sessions established with the old password.
 */
export async function revokeOtherUserSessions(
  pool: Pool,
  userId: string,
  keepSessionId: string
): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM aaelink.sessions WHERE user_id = $1 AND id <> $2`,
    [userId, keepSessionId]
  )
  return rowCount ?? 0
}
