/**
 * `lib/realtime/presenceFanout.ts` — workspace-scoped presence fan-out.
 *
 * A user's presence (heartbeat, custom-status expiry) is relevant only to the
 * workspaces they belong to. Publishing to a single `global:presence` topic
 * would broadcast every heartbeat to every connected client across all
 * workspaces (O(active-users)×O(connected-clients) fan-out) and leak presence
 * across tenants. This helper resolves the user's workspaces and publishes the
 * event to each workspace-scoped presence topic instead.
 */

import type { Pool } from 'pg'
import { getPubSub, presenceTopic, type PubSubEvent } from '@/lib/realtime/redisPubSub'

/**
 * Publish a presence event to the presence topic of every workspace the user
 * belongs to. Best-effort per topic (`allSettled`) so a pubsub outage on one
 * topic — or zero workspaces — never throws or blocks the others; the DB row is
 * the source of truth for the polling consumers regardless.
 */
export async function publishPresenceToUserWorkspaces(
  pool: Pool,
  userId: string,
  event: PubSubEvent
): Promise<void> {
  const { rows } = await pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.workspace_members WHERE user_id = $1`,
    [userId]
  )
  if (rows.length === 0) return
  const pubsub = getPubSub()
  await Promise.allSettled(
    rows.map(r => pubsub.publish(presenceTopic(r.workspace_id), event))
  )
}
