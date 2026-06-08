/**
 * Pure helpers for routing gateway `typing` and `presence` events into local
 * React state. Lives outside the components so they can be unit-tested
 * without mounting the DOM.
 *
 * The home shell calls these from inside the WS event switch in
 * `app/home/page.tsx` after v0.0.43.
 */

import type { PubSubEvent } from '@/lib/realtime/redisPubSub'
import type { ChatPost, MessageReadEvent, ReadReceipt } from '@/lib/realtime/realtime'

/** Mirror of the server cap in `lib/messaging/chat-post.ts` (`MAX_READ_RECEIPTS`). */
const MAX_READ_RECEIPTS = 5

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

/**
 * Narrow an opaque `channel_update` inner payload to a {@link MessageReadEvent}.
 *
 * `POST /api/messages/:id/read` fans the read receipt out wrapped in a
 * `channel_update` (whose `payload` is `unknown` on the PubSubEvent union), so
 * the home shell must re-validate the inner shape before merging it.
 */
export function isMessageReadEvent(value: unknown): value is MessageReadEvent {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    v.type === 'message_read' &&
    typeof v.channel_id === 'string' &&
    typeof v.message_id === 'string' &&
    typeof v.user_id === 'string' &&
    typeof v.read_at === 'number'
  )
}

/**
 * Decision for a WS `channel_update` envelope: its `payload` is opaque
 * (`unknown`), and `POST /api/messages/:id/read` rides a `message_read` inside
 * it. Classify which handling the home shell should apply — merge the reader
 * stack vs. refetch the channel list — in one pure, testable place so the
 * silent-failure modes (guarding the envelope instead of its inner payload, an
 * inverted check) are covered without mounting the React tree.
 */
export type ChannelUpdateAction =
  | { kind: 'read_receipt'; event: MessageReadEvent }
  | { kind: 'refetch_channels' }

export function routeChannelUpdate(inner: unknown): ChannelUpdateAction {
  return isMessageReadEvent(inner)
    ? { kind: 'read_receipt', event: inner }
    : { kind: 'refetch_channels' }
}

/**
 * Merge one reader into a message's receipt list, mirroring the server order
 * (`read_at` desc, then `user_id` asc) and cap ({@link MAX_READ_RECEIPTS}) from
 * `readReceiptsForMessages` so a live-merged stack matches what a later refetch
 * returns. Keeps the earliest `read_at` per reader (the server records first
 * sight) so a duplicate / out-of-order fan-out cannot regress the timestamp.
 *
 * Returns the same reference when nothing changes (reader already present at an
 * equal-or-earlier time) so the caller can `===`-skip the render.
 */
function mergeReceipt(
  receipts: ReadReceipt[] | undefined,
  userId: string,
  readAt: number
): ReadReceipt[] | undefined {
  const list = receipts ?? []
  const existing = list.find(r => r.user_id === userId)
  // Already recorded at an equal-or-earlier time — no change.
  if (existing && existing.read_at <= readAt) return receipts
  const merged = list.filter(r => r.user_id !== userId)
  merged.push({ user_id: userId, read_at: existing ? Math.min(existing.read_at, readAt) : readAt })
  merged.sort((a, b) => b.read_at - a.read_at || (a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0))
  return merged.slice(0, MAX_READ_RECEIPTS)
}

/**
 * Apply a `message_read` fan-out to the channel timeline: merge the reader into
 * the matching post's `read_receipts`. Returns the same array reference when the
 * post is not loaded in this view or the receipt list is unchanged, so React can
 * `===`-compare and skip the render.
 */
export function applyReadReceiptEvent(posts: ChatPost[], event: MessageReadEvent): ChatPost[] {
  let changed = false
  const next = posts.map(p => {
    if (p.id !== event.message_id) return p
    const merged = mergeReceipt(p.read_receipts, event.user_id, event.read_at)
    if (merged === p.read_receipts) return p
    changed = true
    return { ...p, read_receipts: merged }
  })
  return changed ? next : posts
}

function sameReceipts(a: ReadReceipt[] | undefined, b: ReadReceipt[]): boolean {
  const cur = a ?? []
  if (cur.length !== b.length) return false
  for (let i = 0; i < b.length; i++) {
    if (cur[i].user_id !== b[i].user_id || cur[i].read_at !== b[i].read_at) return false
  }
  return true
}

/**
 * Replace loaded posts' `read_receipts` with the server-authoritative stacks
 * from a `read_receipts` SSE/poll delta (`message_id` → reader list). Used on
 * the SSE / polling path where the server sends the full current stack rather
 * than a single-reader event. Returns the same array reference when no loaded
 * post changes so React can `===`-skip the render.
 */
export function applyReadReceiptMap(
  posts: ChatPost[],
  map: Record<string, ReadReceipt[]>
): ChatPost[] {
  let changed = false
  const next = posts.map(p => {
    const incoming = map[p.id]
    if (!incoming || sameReceipts(p.read_receipts, incoming)) return p
    changed = true
    return { ...p, read_receipts: incoming }
  })
  return changed ? next : posts
}
