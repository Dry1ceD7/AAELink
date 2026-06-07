import type { Pool } from 'pg'

/**
 * User activation state, converged with SCIM.
 *
 * Deactivation uses the SAME mechanism the SCIM Users endpoint uses: the
 * `aaelink.users.scim_active` boolean is the single soft-delete flag. SCIM
 * DELETE sets it false and revokes the user's sessions; this module does the
 * same so the admin deactivate path and the SCIM path converge on one flag and
 * one set of side effects.
 *
 * Side effects on deactivate:
 *   - scim_active = false  (login path rejects users with scim_active = false)
 *   - all active sessions in aaelink.sessions revoked (DELETE, as SCIM does) so
 *     an already-signed-in user is forced out immediately
 *
 * Reactivation flips scim_active back to true and revokes nothing.
 */

export interface SetUserActiveResult {
  /** false when the target user id does not exist. */
  found: boolean
  /** Number of session rows removed (only non-zero on deactivate). */
  sessionsRevoked: number
}

/**
 * Set a user's active state. On deactivate (active = false) this also revokes
 * every active session for the user, mirroring SCIM DELETE side effects.
 */
export async function setUserActive(
  pool: Pool,
  userId: string,
  active: boolean
): Promise<SetUserActiveResult> {
  const now = Date.now()
  const { rowCount } = await pool.query(
    `UPDATE aaelink.users SET scim_active = $1, scim_last_sync = $2 WHERE id = $3`,
    [active, now, userId]
  )
  if (!rowCount) return { found: false, sessionsRevoked: 0 }

  let sessionsRevoked = 0
  if (!active) {
    // Same session store readSessionUserId / the login path use, and the same
    // table SCIM DELETE clears — deleting here forces the user out everywhere.
    const del = await pool.query(`DELETE FROM aaelink.sessions WHERE user_id = $1`, [userId])
    sessionsRevoked = del.rowCount ?? 0
  }
  return { found: true, sessionsRevoked }
}
