/**
 * D7 Events API — subscription matching + delivery deduplication.
 *
 * Two server-side primitives the event dispatcher uses:
 *
 *  - eventMatches: does a subscription's event list cover an event type (exact
 *    or '*' wildcard)?
 *  - claimEventDelivery: atomically claim the right to deliver one logical event
 *    to one subscription. The Grid hazard is that a message in a multi-workspace
 *    shared channel (D1) emits the same event once per sharing workspace; the
 *    dedup key folds those into a single delivery, so a stateless, horizontally
 *    scaled dispatcher never double-sends.
 */
import type { Pool } from 'pg'

/** Whether a subscription's event list covers an event type. '*' matches all. */
export function eventMatches(subscribedEvents: string[], eventType: string): boolean {
  if (!Array.isArray(subscribedEvents)) return false
  return subscribedEvents.includes('*') || subscribedEvents.includes(eventType)
}

/**
 * Stable dedup key for one logical event to one subscription. Dedup is on the
 * timestamp plus channel key (per the Grid hazard), scoped per subscription so
 * different subscribers each still get one copy.
 */
export function dedupKey(params: {
  subscriptionId: string
  eventType: string
  channelKey: string
  eventTs: number | string
}): string {
  return [params.subscriptionId, params.eventType, params.channelKey || '', String(params.eventTs)].join('|')
}

/**
 * Claim delivery of an event to a subscription. Returns true the first time
 * (caller should deliver) and false on any subsequent claim of the same key
 * (caller should skip — it's a re-emit). Atomic via INSERT ... ON CONFLICT.
 */
export async function claimEventDelivery(
  pool: Pool,
  params: {
    subscriptionId: string
    eventType: string
    channelKey: string
    eventTs: number | string
  },
  now = Date.now()
): Promise<boolean> {
  const key = dedupKey(params)
  const { rowCount } = await pool.query(
    `INSERT INTO aaelink.event_deliveries (dedup_key, subscription_id, event_type, channel_key, event_ts, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (dedup_key) DO NOTHING`,
    [key, params.subscriptionId, params.eventType, params.channelKey || '', Number(params.eventTs) || 0, now]
  )
  return (rowCount ?? 0) > 0
}
