/**
 * `lib/wsClient.ts` — browser-side WebSocket client for the v0.0.35+ gateway.
 *
 * Speaks the protocol declared in `lib/wsGateway/protocol.ts`. Connect, send
 * subscribe/unsubscribe/ping frames, receive event/hello/pong/error frames.
 * The connection lifecycle (auto-reconnect, ping every 30s, replay-on-resume
 * via the `since` cursor) lives here; the gateway-side parser is in
 * `lib/wsGateway/protocol.ts` and the two are kept in lock-step by sharing
 * field names verbatim.
 *
 * The exported `parseServerFrame` and `serializeClientFrame` are pure and
 * tested in `tests/wsClient.test.ts`. The `connectWsCollab` helper is the
 * browser-only consumer wired into `lib/realtime.ts` when a gateway URL is
 * available.
 */

import type { PubSubEvent } from '@/lib/realtime/redisPubSub'

// ── Frame shapes — duplicated from `lib/wsGateway/protocol.ts` to keep this
//    module fetchable on both client and server (`@/lib/wsGateway/protocol`
//    transitively imports server-only modules through `redisPubSub`).
// ────────────────────────────────────────────────────────────────────

export type ClientFrameOut =
  | { type: 'subscribe'; channel_id: string; since?: string }
  | { type: 'subscribe'; topic: string; since?: string }
  | { type: 'unsubscribe'; channel_id: string }
  | { type: 'unsubscribe'; topic: string }
  | { type: 'ping' }

export type ServerFrameIn =
  | { type: 'hello'; user_id: string }
  | {
      type: 'event'
      topic: string
      id: string
      payload: PubSubEvent
      replay: boolean
    }
  | { type: 'pong' }
  | { type: 'error'; code: string; message?: string }

export function serializeClientFrame(frame: ClientFrameOut): string {
  return JSON.stringify(frame)
}

export function parseServerFrame(raw: string): ServerFrameIn | null {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof json !== 'object' || json === null) return null
  const obj = json as Record<string, unknown>
  switch (obj.type) {
    case 'hello': {
      const userId = obj.user_id
      return typeof userId === 'string' ? { type: 'hello', user_id: userId } : null
    }
    case 'pong':
      return { type: 'pong' }
    case 'event': {
      const topic = obj.topic
      const id = obj.id
      const payload = obj.payload
      if (typeof topic !== 'string' || topic.length === 0) return null
      if (typeof id !== 'string' || id.length === 0) return null
      if (typeof payload !== 'object' || payload === null) return null
      return {
        type: 'event',
        topic,
        id,
        payload: payload as PubSubEvent,
        replay: obj.replay === true,
      }
    }
    case 'error': {
      const code = obj.code
      if (typeof code !== 'string') return null
      const message = typeof obj.message === 'string' ? obj.message : undefined
      return message !== undefined
        ? { type: 'error', code, message }
        : { type: 'error', code }
    }
    default:
      return null
  }
}

// ── Browser-only: connection lifecycle ──────────────────────────────

export interface WsCollabHandle {
  /** Send `subscribe` for an additional channel; safe to call multiple times. */
  subscribe(channelId: string, since?: string): void
  /** Send `unsubscribe` for a channel. */
  unsubscribe(channelId: string): void
  /** Send `subscribe` for a non-channel topic (e.g. `global:presence`). */
  subscribeTopic(topic: string, since?: string): void
  /** Send `unsubscribe` for a non-channel topic. */
  unsubscribeTopic(topic: string): void
  /** Disconnect and stop reconnecting. */
  close(): void
  /** Last-seen event id per topic, for resume-with-since on reconnect. */
  cursors(): Record<string, string>
}

export interface WsCollabOptions {
  /** Full ws:// or wss:// URL of the gateway, e.g. `wss://ws.example.com/ws` */
  url: string
  channelId: string
  /** Initial replay cursor; pass the last id received for this channel. */
  initialSince?: string
  onEvent: (frame: Extract<ServerFrameIn, { type: 'event' }>) => void
  onHello?: (userId: string) => void
  onError?: (frame: Extract<ServerFrameIn, { type: 'error' }>) => void
  /** Status hook — `true` while the socket is open, `false` between attempts. */
  onConnected?: (connected: boolean) => void
  /** Reconnect backoff base in ms (linear). Default 700. */
  reconnectBaseMs?: number
  /** Cap on consecutive reconnect attempts. Default 8. */
  maxReconnectAttempts?: number
  /** Heartbeat interval in ms. Default 30_000. */
  pingIntervalMs?: number
}

const DEFAULTS = {
  reconnectBaseMs: 700,
  maxReconnectAttempts: 8,
  pingIntervalMs: 30_000,
}

export function connectWsCollab(opts: WsCollabOptions): WsCollabHandle {
  const cfg = { ...DEFAULTS, ...opts }
  const cursors = new Map<string, string>()
  if (opts.initialSince) cursors.set(`channel:${opts.channelId}`, opts.initialSince)

  /** Channels we are currently subscribed to (echoed on every reconnect). */
  const channels = new Set<string>([opts.channelId])
  /** Topics (non-channel) we are currently subscribed to (echoed on every reconnect). */
  const topics = new Set<string>()
  let socket: WebSocket | null = null
  let reconnectAttempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let pingTimer: ReturnType<typeof setInterval> | null = null
  let disposed = false

  const clearReconnect = (): void => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  const stopPing = (): void => {
    if (pingTimer) {
      clearInterval(pingTimer)
      pingTimer = null
    }
  }

  const startPing = (): void => {
    stopPing()
    pingTimer = setInterval(() => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(serializeClientFrame({ type: 'ping' }))
      }
    }, cfg.pingIntervalMs)
  }

  const sendIfOpen = (frame: ClientFrameOut): void => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(serializeClientFrame(frame))
    }
  }

  const subscribeChannel = (channelId: string, since?: string): void => {
    channels.add(channelId)
    const cursor = since ?? cursors.get(`channel:${channelId}`)
    sendIfOpen(
      cursor !== undefined
        ? { type: 'subscribe', channel_id: channelId, since: cursor }
        : { type: 'subscribe', channel_id: channelId }
    )
  }

  const unsubscribeChannel = (channelId: string): void => {
    channels.delete(channelId)
    sendIfOpen({ type: 'unsubscribe', channel_id: channelId })
  }

  const subscribeTopic = (topic: string, since?: string): void => {
    topics.add(topic)
    const cursor = since ?? cursors.get(topic)
    sendIfOpen(
      cursor !== undefined
        ? { type: 'subscribe', topic, since: cursor }
        : { type: 'subscribe', topic }
    )
  }

  const unsubscribeTopic = (topic: string): void => {
    topics.delete(topic)
    sendIfOpen({ type: 'unsubscribe', topic })
  }

  const open = (): void => {
    if (disposed) return
    if (typeof WebSocket === 'undefined') return
    clearReconnect()
    try {
      const ws = new WebSocket(cfg.url)
      socket = ws

      ws.onopen = () => {
        reconnectAttempt = 0
        cfg.onConnected?.(true)
        // Re-subscribe (with up-to-date `since`) every time the socket opens.
        for (const cid of channels) subscribeChannel(cid)
        for (const t of topics) subscribeTopic(t)
        startPing()
      }

      ws.onmessage = (ev) => {
        const frame = parseServerFrame(typeof ev.data === 'string' ? ev.data : '')
        if (!frame) return
        switch (frame.type) {
          case 'hello':
            cfg.onHello?.(frame.user_id)
            break
          case 'event':
            cursors.set(frame.topic, frame.id)
            cfg.onEvent(frame)
            break
          case 'pong':
            // heartbeat ack; no action
            break
          case 'error':
            cfg.onError?.(frame)
            break
        }
      }

      ws.onclose = () => {
        socket = null
        cfg.onConnected?.(false)
        stopPing()
        if (disposed) return
        reconnectAttempt += 1
        if (reconnectAttempt <= cfg.maxReconnectAttempts) {
          const delay = cfg.reconnectBaseMs * Math.min(reconnectAttempt, 5)
          reconnectTimer = setTimeout(() => open(), delay)
        }
      }

      ws.onerror = () => {
        // The `close` handler does the reconnect work.
      }
    } catch {
      // Synchronous construction error — schedule a retry.
      reconnectAttempt += 1
      if (reconnectAttempt <= cfg.maxReconnectAttempts) {
        const delay = cfg.reconnectBaseMs * Math.min(reconnectAttempt, 5)
        reconnectTimer = setTimeout(() => open(), delay)
      }
    }
  }

  open()

  return {
    subscribe: subscribeChannel,
    unsubscribe: unsubscribeChannel,
    subscribeTopic,
    unsubscribeTopic,
    close: () => {
      disposed = true
      clearReconnect()
      stopPing()
      try { socket?.close() } catch { /* ignore */ }
      socket = null
    },
    cursors: () => Object.fromEntries(cursors),
  }
}
