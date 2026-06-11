/**
 * Custom-status expiry sweep (Slack-style "clear after").
 *
 * A user can set a custom status with an expiry (`user_status.expires_at`, epoch
 * ms — see PUT /api/user-status and app/home/CustomStatusPopup.tsx). Until now
 * the only enforcement was best-effort, lazy clears: GET /api/user-status clears
 * an expired status when the owner happens to read it, and POST
 * /api/user-status/expire clears in bulk only when something calls it. Neither
 * fires for a user who set a 30-minute status and then went idle — the status
 * lingered past its deadline.
 *
 * This module is the server-side heartbeat that closes that gap. The worker
 * (lib/infra/worker.ts) runs `clearExpiredStatuses` on a ~60s interval; it finds
 * every user whose status has expired and is not currently `online`, clears the
 * profile fields (users.status_text / status_emoji) and resets the user_status
 * row (expires_at → 0), then emits a presence event per cleared user so live
 * clients refresh. `nowMs` is a parameter so the sweep is deterministic in tests;
 * the worker passes `Date.now()`.
 *
 * Why `status <> 'online'`: an expired custom status with presence still
 * `online` is the owner actively present with a stale label — the lazy GET path
 * already flips those back to a clean `online` on next read. The sweep targets
 * the away/dnd/offline users who will not hit that read path soon, matching the
 * SLICE contract (clear where expires_at>0 AND expires_at<nowMs AND
 * status<>'online').
 */

import type { Pool } from 'pg'
import { type PubSubEvent } from '@/lib/realtime/redisPubSub'
import { publishPresenceToUserWorkspaces } from '@/lib/realtime/presenceFanout'
import { log } from '@/lib/infra/log'

/**
 * Clear every expired-and-not-online custom status. Returns the user_ids whose
 * status was cleared this pass.
 *
 * Idempotent: a status already cleared (expires_at = 0) no longer matches the
 * predicate, so a re-run (or a duplicate job) clears nothing twice and emits no
 * spurious presence events.
 */
export async function clearExpiredStatuses(pool: Pool, nowMs: number): Promise<string[]> {
  // Single statement: reset the matching user_status rows and, via a CTE, mirror
  // the clear to the users profile columns, RETURNING the affected user_ids. The
  // predicate is evaluated once against the original rows (status <> 'online' on
  // the pre-update value), so the RETURNING list is exactly the cleared set.
  const { rows } = await pool.query<{ user_id: string }>(
    `WITH expired AS (
       UPDATE aaelink.user_status
          SET custom_text = '',
              expires_at  = 0,
              updated_at  = $1
        WHERE expires_at > 0
          AND expires_at < $1
          AND status <> 'online'
        RETURNING user_id
     ),
     mirrored AS (
       UPDATE aaelink.users
          SET status_text = '', status_emoji = ''
        WHERE id IN (SELECT user_id FROM expired)
       RETURNING id
     )
     SELECT user_id FROM expired`,
    [nowMs]
  )

  const clearedUserIds = rows.map(r => r.user_id)

  // Emit a presence event per cleared user so live clients drop the stale custom
  // status. Best-effort — a Redis/pubsub outage must never fail the sweep, and
  // the DB rows above are already the source of truth.
  for (const userId of clearedUserIds) {
    const event: PubSubEvent = {
      type: 'presence',
      user_id: userId,
      status: 'offline',
      last_seen: nowMs,
    }
    try {
      // Fan out only to the user's own workspaces (no global cross-tenant broadcast).
      await publishPresenceToUserWorkspaces(pool, userId, event)
    } catch (err) {
      log.warn('userStatusExpiry.emit_failed', {
        user_id: userId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return clearedUserIds
}
