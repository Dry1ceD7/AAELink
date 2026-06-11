/**
 * Guest account revocation + scheduled expiry (Admin parity 29).
 *
 * admin/guests/route.ts stored guest_accounts.expires_at but nothing ever
 * enforced it — an expired guest kept their channel membership and live
 * sessions indefinitely. This module is the single revoke path, shared by:
 *
 *   - the manual DELETE /api/admin/guests handler (admin clicks "revoke"), and
 *   - the worker 'guest_expire' heartbeat (lib/infra/worker.ts), which finds
 *     guests past expires_at and revokes them automatically.
 *
 * revokeGuestAccount is the convergence point: it removes the guest's channel
 * access + memberships, the guest_accounts row, the workspace 'guest'
 * membership, and (critically) kills their live sessions so an expired guest
 * cannot continue using an already-authenticated client. It writes a
 * best-effort audit_log row per revoke (actor = the admin for manual revokes,
 * the seeded worker user for scheduled expiry).
 *
 * runGuestExpiry is the worker job body: it selects guests whose expires_at is
 * a real deadline (> 0) in the past and revokes each one. Idempotent — a guest
 * already gone (account row deleted) is silently skipped, so a re-run after a
 * partial pass (or a duplicate job) does no harm and double-counts nothing.
 */

import type { Pool } from 'pg'
import { randomUUID } from 'crypto'

/** A guest_accounts row's revocable identity. */
export interface GuestRevokeTarget {
  guestId: string
  userId: string
  workspaceId: string
}

export interface RevokeOptions {
  /** audit_log.actor_id — the admin (manual) or worker user (scheduled). */
  actorId: string
  /** audit_log.action — 'guest.revoke' (manual) or 'guest.expire' (scheduled). */
  action?: string
}

/**
 * Revoke ONE guest: drop channel memberships for the assigned channels, delete
 * the guest_accounts row, drop the workspace 'guest' membership, and kill the
 * guest's live sessions. Returns false when the guest no longer exists (already
 * revoked) so callers can treat it as a no-op; true when a revoke happened.
 *
 * The session delete is the security-relevant difference from the pre-parity
 * manual path, which left an expired guest's cookies valid: revocation MUST log
 * the guest out, not just strip future access.
 */
export async function revokeGuestAccount(
  pool: Pool,
  guestId: string,
  opts: RevokeOptions,
): Promise<boolean> {
  const { rows } = await pool.query<{ user_id: string; workspace_id: string }>(
    `SELECT user_id, workspace_id FROM aaelink.guest_accounts WHERE id = $1`,
    [guestId],
  )
  if (!rows[0]) return false
  const userId = rows[0].user_id
  const workspaceId = rows[0].workspace_id

  // Remove channel memberships for every channel the guest was granted.
  const { rows: access } = await pool.query<{ channel_id: string }>(
    `SELECT channel_id FROM aaelink.guest_channel_access WHERE guest_id = $1`,
    [guestId],
  )
  for (const a of access) {
    await pool.query(
      `DELETE FROM aaelink.channel_members WHERE channel_id = $1 AND user_id = $2`,
      [a.channel_id, userId],
    )
  }

  // Remove guest account (cascades guest_channel_access) and workspace membership.
  await pool.query(`DELETE FROM aaelink.guest_accounts WHERE id = $1`, [guestId])
  await pool.query(
    `DELETE FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2 AND role = 'guest'`,
    [workspaceId, userId],
  )

  // Kill live sessions so an expired/revoked guest is logged out immediately.
  await pool.query(`DELETE FROM aaelink.sessions WHERE user_id = $1`, [userId])

  // Audit (best-effort — never fail the revoke on an audit write).
  try {
    await pool.query(
      `INSERT INTO aaelink.audit_log (id, workspace_id, actor_id, action, resource_id, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        workspaceId,
        opts.actorId,
        opts.action || 'guest.revoke',
        guestId,
        JSON.stringify({ user_id: userId }),
        Date.now(),
      ],
    )
  } catch { /* best-effort */ }

  return true
}

export interface GuestExpiryResult {
  /** Guests past expires_at considered this run. */
  considered: number
  /** Guests actually revoked (excludes ones already gone on re-read). */
  revoked: number
}

/** The synthetic actor recorded on scheduled (non-admin) expiry audit rows. */
export const GUEST_EXPIRE_ACTOR = 'system:guest_expire'

/**
 * Find guests whose expires_at is a real deadline in the past and revoke each.
 * `expires_at = 0` means "no expiry" (the route's default) and is never swept.
 * Idempotent: a guest deleted between the scan and the revoke is skipped, so a
 * re-run revokes nothing the previous run already handled.
 */
export async function runGuestExpiry(pool: Pool, now = Date.now()): Promise<GuestExpiryResult> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM aaelink.guest_accounts WHERE expires_at > 0 AND expires_at <= $1`,
    [now],
  )
  let revoked = 0
  for (const r of rows) {
    const did = await revokeGuestAccount(pool, r.id, {
      actorId: GUEST_EXPIRE_ACTOR,
      action: 'guest.expire',
    })
    if (did) revoked++
  }
  return { considered: rows.length, revoked }
}
