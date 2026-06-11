/**
 * Knowledge realtime emit seam — canvas + list liveness.
 *
 * Stage B wires canvas/list/list-item mutations onto the same pub/sub fan-out the
 * chat surfaces use (lib/realtime/redisPubSub), so a second editor/viewer sees
 * changes without a manual refetch. We follow the messages/typing emit pattern:
 *   getPubSub().publish(<topic>, event)   — wrapped in try/catch so a Redis
 *   outage can never break the route's 2xx (the DB row stays the source of truth).
 *
 * Transport detail: the WS gateway only forwards a fixed set of PubSubEvent
 * `type`s (see lib/realtime/wsTransport.ts WsMessageType). 'channel_update' is the
 * one already plumbed end-to-end (home/page.tsx refetches the channel list on it).
 * Rather than invent new event types the client cannot yet route, we ride
 * 'channel_update' and put the knowledge-specific detail in `payload` (a
 * discriminated `{ kind, ... }`). The current client treats channel_update as an
 * opaque "something changed, refetch" signal; richer client handling can read
 * `payload.kind` later without a transport change.
 *
 * Scoping (delivery-honest):
 *   - When the entity has a channel_id, emit on channelTopic(channel_id) so every
 *     channel subscriber gets it (mirrors how messages fan out). This is the only
 *     topic the client actually subscribes to today (home/page.tsx opens the
 *     active channel topic; the WS gateway also auto-subscribes channel topics).
 *   - When there is NO channel (a standalone/personal list or personal canvas),
 *     there is currently NO consumer: the client never subscribes to its own
 *     user:<id> topic (grep finds zero subscribeTopic call sites for user topics),
 *     so an owner-scoped publish would go into the void. Rather than imply a
 *     liveness that does not ship, we DO NOT emit for channel-less entities. When a
 *     client subscribes to userTopic(me.id) on connect, re-enable the owner branch
 *     (the `ownerId` plumbing is retained in scope for that day) and add a
 *     gateway-level delivery test.
 *
 * This module is intentionally a thin, import-spyable seam: tests assert emits by
 * spying on `emitKnowledgeEvent` (unit) or on getPubSub().publish.
 */
import {
  getPubSub,
  channelTopic,
  type PubSubEvent,
} from '@/lib/realtime/redisPubSub'
import { log } from '@/lib/infra/log'

/** Knowledge-domain payloads carried inside a `channel_update` PubSubEvent. */
export type KnowledgePayload =
  | { kind: 'canvas.updated'; canvas_id: string; channel_id: string; updated_at: number }
  | { kind: 'canvas.deleted'; canvas_id: string; channel_id: string; deleted_at: number }
  | { kind: 'list.updated'; list_id: string; channel_id: string }
  | { kind: 'list_item.created'; list_id: string; item_id: string; channel_id: string }
  | { kind: 'list_item.updated'; list_id: string; item_id: string; channel_id: string }
  | { kind: 'list_item.deleted'; list_id: string; item_id: string; channel_id: string }

/**
 * Emit a knowledge event on the channel topic when `channelId` is set. For a
 * channel-less entity there is no client consumer today, so we emit nothing
 * (see the scoping note above). `ownerId` is accepted for forward-compat and is
 * currently unused for delivery. Never throws.
 */
export async function emitKnowledgeEvent(
  payload: KnowledgePayload,
  scope: { channelId?: string | null; ownerId?: string | null }
): Promise<void> {
  const channelId = (scope.channelId || '').trim()
  // No channel → no subscriber → nothing to broadcast (see module scoping note).
  if (!channelId) return

  // Ride the already-plumbed 'channel_update' transport. channel_id on the event
  // is the routing key the WS gateway/SSE consumers expect.
  const event: PubSubEvent = {
    type: 'channel_update',
    channel_id: channelId,
    payload,
  }

  try {
    await getPubSub().publish(channelTopic(channelId), event)
  } catch (err) {
    log.warn('knowledge.realtime.emit_failed', {
      kind: payload.kind,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
