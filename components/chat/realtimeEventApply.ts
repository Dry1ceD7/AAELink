/**
 * Pure helpers for routing gateway `typing` and `presence` events into local
 * React state. Lives outside the components so they can be unit-tested
 * without mounting the DOM.
 *
 * The home shell calls these from inside the WS event switch in
 * `app/home/page.tsx` after v0.0.43.
 */

import type { PubSubEvent } from '@/lib/realtime/redisPubSub'

/** `channel_id` → `user_id` → ms-since-epoch when the typing event arrived. */
export type TypingState = Record<string, Record<string, number>>

/** `user_id` → ms-since-epoch when the latest presence heartbeat landed. */
export type PresenceLastSeenMap = Record<string, number>

/**
 * Apply a `typing` event to the typing state.
 *
 * - On `active: true`, records the user under the channel with the supplied
 *   timestamp. Subsequent reads can apply the typing TTL (`TYPING_TTL_MS`)
 *   themselves to fade out stale entries.
 * - On `active: false`, removes the user from the channel.
 * - On any other event type, returns the input reference unchanged.
 *
 * Returns the same reference when nothing actually changes (removing a user
 * who was not present, ignoring a non-typing event) so React can `===`-compare
 * and skip the render.
 */
export function applyTypingEvent(
  state: TypingState,
  event: PubSubEvent,
  nowMs: number
): TypingState {
  if (event.type !== 'typing') return state
  const { channel_id: channelId, user_id: userId, active } = event
  const channelMap = state[channelId]
  if (active) {
    const next = { ...(channelMap ?? {}), [userId]: nowMs }
    return { ...state, [channelId]: next }
  }
  // active === false — drop the user.
  if (!channelMap || !(userId in channelMap)) return state
  const next = { ...channelMap }
  delete next[userId]
  return { ...state, [channelId]: next }
}

/**
 * Apply a `presence` event to the last-seen map. Newer `last_seen` values
 * overwrite older ones; older or equal values are ignored so out-of-order
 * pub/sub fan-out cannot regress a user's presence.
 *
 * Returns the same reference when nothing changes.
 */
export function applyPresenceEvent(
  map: PresenceLastSeenMap,
  event: PubSubEvent
): PresenceLastSeenMap {
  if (event.type !== 'presence') return map
  const { user_id: userId, last_seen: lastSeen } = event
  const existing = map[userId] ?? 0
  if (lastSeen <= existing) return map
  return { ...map, [userId]: lastSeen }
}
