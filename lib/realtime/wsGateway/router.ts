/**
 * `lib/wsGateway/router.ts` — per-connection state for the WebSocket gateway.
 *
 * Owns the subscription set for a single client. Receives raw message strings
 * from the WS server, parses them via `protocol.ts`, and forwards published
 * events from the injected `PubSubAdapter` back to the client. The client only
 * sees events for channels it is subscribed to; cross-channel leaks are caught
 * by the topic match before the JSON serialize.
 *
 * The router is **transport-agnostic**: it accepts an injected `OutboundSocket`
 * with `send(string)` / `close()` so the unit tests can replace `ws` with a
 * capturing fake. The boot script (`scripts/wsGateway.ts`) wraps the real `ws`
 * `WebSocket` instance to satisfy this interface.
 *
 * Optional security hardening (v0.0.43+):
 *
 * - `topicAllowlist` — regexes that any subscribe `topic` must match.
 *   Channel-keyed subscribes (`channel_id`) are always allowed because the
 *   router builds the topic via `channelTopic(channelId)` itself.
 * - `maxSubscriptions` — hard cap on concurrent subscriptions.
 * - `maxFramesPerWindow` / `frameWindowMs` — sliding-window inbound rate
 *   limit; over-budget frames trigger a `rate_limited` error frame.
 *
 * When the security config is omitted, behavior matches v0.0.42 (no allowlist,
 * no rate limit, no subscription cap).
 */

import type { PubSubAdapter, PubSubEvent } from '@/lib/realtime/redisPubSub'
import { channelTopic } from '@/lib/realtime/redisPubSub'
import {
  parseClientFrame,
  serializeServerFrame,
  type ServerFrame,
} from '@/lib/realtime/wsGateway/protocol'
import type { ReplayStore } from '@/lib/realtime/wsGateway/replay'

export interface OutboundSocket {
  send(message: string): void
  close(): void
}

export interface SecurityConfig {
  /** Regexes any topic must match. Default: `DEFAULT_TOPIC_ALLOWLIST`. */
  topicAllowlist?: ReadonlyArray<RegExp>
  /** Hard cap on concurrent subscriptions per connection. */
  maxSubscriptions?: number
  /** Inbound frame budget for the sliding window. */
  maxFramesPerWindow?: number
  /** Sliding-window length in ms. */
  frameWindowMs?: number
}

export interface ConnectionOptions {
  pubsub: PubSubAdapter
  socket: OutboundSocket
  userId: string
  /** Optional replay store. When provided, `subscribe` frames with a `since`
   *  cursor trigger a `since()` query and the missed events are flushed back
   *  to the client (with `replay: true`) before the live stream starts. */
  replay?: ReplayStore
  /** Optional security hardening. See `SecurityConfig`. */
  security?: SecurityConfig
}

export interface Connection {
  /** Process a single inbound message frame from the client. */
  handleMessage(raw: string): void
  /** Tear down all subscriptions and unhook from the pub/sub bus. */
  close(): void
  /** Channels this connection is currently subscribed to (for diagnostics). */
  subscribedChannels(): readonly string[]
}

/**
 * Default topic allowlist. Covers every topic shape `lib/redisPubSub.ts`
 * exports a helper for: channel:<id>, user:<id>, global:presence,
 * workspace:<id>. Add new entries here when introducing a new topic prefix
 * server-side; clients can also pass a custom allowlist via `SecurityConfig`.
 */
export const DEFAULT_TOPIC_ALLOWLIST: ReadonlyArray<RegExp> = Object.freeze([
  /^channel:[A-Za-z0-9_-]+$/,
  /^user:[A-Za-z0-9_-]+$/,
  /^workspace:[A-Za-z0-9_-]+$/,
  /^presence:[A-Za-z0-9_-]+$/,
  /^global:presence$/,
])

export function createConnection(opts: ConnectionOptions): Connection {
  const { pubsub, socket, userId, replay, security } = opts

  /** topic → unsubscribe handle from `pubsub.subscribe` */
  const subscriptions = new Map<string, () => void>()
  /** topic → most recent live event id, for replay-cursor advancement. */
  const lastLiveId = new Map<string, string>()
  let closed = false

  // ── Security state ────────────────────────────────────────────────
  const topicAllowlist = security?.topicAllowlist ?? DEFAULT_TOPIC_ALLOWLIST
  const maxSubscriptions = security?.maxSubscriptions
  const maxFramesPerWindow = security?.maxFramesPerWindow
  const frameWindowMs = security?.frameWindowMs ?? 1_000
  /** Timestamps of inbound frames inside the current window. */
  const frameTimestamps: number[] = []

  const send = (frame: ServerFrame): void => {
    if (closed) return
    socket.send(serializeServerFrame(frame))
  }

  const sendError = (code: string, message?: string): void => {
    send({ type: 'error', code, ...(message ? { message } : {}) })
  }

  const isTopicAllowed = (topic: string): boolean => {
    return topicAllowlist.some((re) => re.test(topic))
  }

  const wouldExceedSubscriptionCap = (topic: string): boolean => {
    if (maxSubscriptions === undefined) return false
    if (subscriptions.has(topic)) return false // duplicate is a no-op
    return subscriptions.size >= maxSubscriptions
  }

  const isOverFrameBudget = (): boolean => {
    if (maxFramesPerWindow === undefined) return false
    const now = Date.now()
    const cutoff = now - frameWindowMs
    while (frameTimestamps.length > 0 && frameTimestamps[0] < cutoff) {
      frameTimestamps.shift()
    }
    if (frameTimestamps.length >= maxFramesPerWindow) return true
    frameTimestamps.push(now)
    return false
  }

  // Send the hello frame immediately so the client knows the connection is
  // authenticated and can start subscribing.
  send({ type: 'hello', user_id: userId })

  const subscribeTopic = (topic: string, since?: string): void => {
    if (subscriptions.has(topic)) return // idempotent
    if (!isTopicAllowed(topic)) {
      sendError('topic_not_allowed', `Topic ${topic} not on the allowlist.`)
      return
    }
    if (wouldExceedSubscriptionCap(topic)) {
      sendError('subscription_limit', `Per-connection subscription cap reached.`)
      return
    }

    // Subscribe to the live stream first so any events that arrive while we
    // are flushing the replay are still recorded; the replay re-emits in
    // record order so duplicates don't appear (each event id is monotonic).
    let replayingDone = false
    const liveBuffer: Array<{ id: string; event: PubSubEvent }> = []
    const handle = pubsub.subscribe(topic, (event: PubSubEvent) => {
      const id = `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      lastLiveId.set(topic, id)
      if (!replayingDone) {
        liveBuffer.push({ id, event })
        return
      }
      send({ type: 'event', topic, id, payload: event })
    })
    subscriptions.set(topic, handle)

    if (replay && since) {
      void (async () => {
        try {
          const missed = await replay.since(topic, since)
          for (const entry of missed) {
            if (closed) break
            send({ type: 'event', topic, id: entry.id, payload: entry.event, replay: true })
          }
        } catch {
          // Replay failures should not break the live stream.
        } finally {
          // Flush anything that arrived while the replay query was in flight.
          for (const buffered of liveBuffer) {
            if (closed) break
            send({ type: 'event', topic, id: buffered.id, payload: buffered.event })
          }
          liveBuffer.length = 0
          replayingDone = true
        }
      })()
    } else {
      replayingDone = true
    }
  }

  const subscribeChannel = (channelId: string, since?: string): void => {
    subscribeTopic(channelTopic(channelId), since)
  }

  const unsubscribeTopic = (topic: string): void => {
    const handle = subscriptions.get(topic)
    if (!handle) return
    handle()
    subscriptions.delete(topic)
    lastLiveId.delete(topic)
  }

  const unsubscribeChannel = (channelId: string): void => {
    unsubscribeTopic(channelTopic(channelId))
  }

  const close = (): void => {
    if (closed) return
    closed = true
    for (const handle of subscriptions.values()) handle()
    subscriptions.clear()
    lastLiveId.clear()
  }

  const handleMessage = (raw: string): void => {
    if (closed) return
    if (isOverFrameBudget()) {
      sendError('rate_limited', 'Inbound frame rate exceeded.')
      return
    }
    const frame = parseClientFrame(raw)
    if (!frame) {
      sendError('invalid_frame', 'Frame could not be parsed.')
      return
    }
    switch (frame.type) {
      case 'subscribe':
        if ('topic' in frame) {
          subscribeTopic(frame.topic, frame.since)
        } else {
          subscribeChannel(frame.channel_id, frame.since)
        }
        break
      case 'unsubscribe':
        if ('topic' in frame) {
          unsubscribeTopic(frame.topic)
        } else {
          unsubscribeChannel(frame.channel_id)
        }
        break
      case 'ping':
        send({ type: 'pong' })
        break
    }
  }

  return {
    handleMessage,
    close,
    subscribedChannels: () => Array.from(subscriptions.keys()),
  }
}
