/**
 * `lib/wsGateway/protocol.ts` — frame schema for the WebSocket gateway.
 *
 * Messages travel as JSON envelopes. Both directions share the same wire shape
 * (`{ type, ... }`) but the discriminated unions below split allowed payloads
 * by direction so the gateway can refuse client frames that look like server
 * events and vice-versa. Unknown extra fields are silently dropped — be liberal
 * in what you accept; do not break the protocol when a future client adds an
 * optional hint field.
 *
 * `subscribe` and `unsubscribe` accept exactly one of `channel_id` or `topic`.
 * Channel-keyed callers stay on `channel_id`; the router translates that into
 * a Redis topic via `channelTopic()`. Topic-keyed callers (e.g. presence on
 * `'global:presence'`) pass the bare topic string and the router forwards it
 * verbatim to `pubsub.subscribe`. See ADR-0002 for the rationale.
 */

import type { PubSubEvent } from '@/lib/realtime/redisPubSub'

// ── Client → Server ─────────────────────────────────────────────────

export type ClientFrame =
  | { type: 'subscribe'; channel_id: string; since?: string }
  | { type: 'subscribe'; topic: string; since?: string }
  | { type: 'unsubscribe'; channel_id: string }
  | { type: 'unsubscribe'; topic: string }
  | { type: 'ping' }

/**
 * Parse a single client frame. Returns `null` for any input the server should
 * not process — malformed JSON, unknown `type`, missing/empty/non-string
 * `channel_id` or `topic` on (un)subscribe, or both fields set at once.
 *
 * `subscribe` accepts an optional `since` cursor (opaque non-empty string)
 * for replay-on-reconnect.
 */
export function parseClientFrame(raw: string): ClientFrame | null {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof json !== 'object' || json === null) return null
  const obj = json as Record<string, unknown>
  const type = obj.type
  if (type === 'ping') return { type: 'ping' }

  if (type === 'subscribe' || type === 'unsubscribe') {
    const channelIdRaw = obj.channel_id
    const topicRaw = obj.topic
    const hasChannelId = typeof channelIdRaw === 'string' && channelIdRaw.length > 0
    const hasTopic = typeof topicRaw === 'string' && topicRaw.length > 0

    // Reject frames where channel_id or topic is present but not a non-empty
    // string (number, empty string, null, etc.). Reject when both are set or
    // neither is set.
    if ('channel_id' in obj && !hasChannelId) return null
    if ('topic' in obj && !hasTopic) return null
    if (hasChannelId === hasTopic) return null // both true → ambiguous; both false → empty

    if (type === 'unsubscribe') {
      return hasChannelId
        ? { type, channel_id: channelIdRaw as string }
        : { type, topic: topicRaw as string }
    }

    // type === 'subscribe' — also carries an optional `since` cursor.
    const sinceRaw = obj.since
    const since =
      typeof sinceRaw === 'string' && sinceRaw.length > 0 ? sinceRaw : undefined

    if (hasChannelId) {
      return since !== undefined
        ? { type, channel_id: channelIdRaw as string, since }
        : { type, channel_id: channelIdRaw as string }
    }
    return since !== undefined
      ? { type, topic: topicRaw as string, since }
      : { type, topic: topicRaw as string }
  }

  return null
}

// ── Server → Client ─────────────────────────────────────────────────

export type ServerFrame =
  | { type: 'hello'; user_id: string }
  | { type: 'event'; topic: string; id: string; payload: PubSubEvent; replay?: boolean }
  | { type: 'pong' }
  | { type: 'error'; code: string; message?: string }

export function serializeServerFrame(frame: ServerFrame): string {
  return JSON.stringify(frame)
}
