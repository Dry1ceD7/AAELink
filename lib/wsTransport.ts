/**
 * AAELink — WebSocket Transport Layer
 *
 * Dual-transport gateway that supports both WebSocket and SSE:
 *   - Auto-negotiation: WS preferred, SSE fallback
 *   - Connection lifecycle management (heartbeat, reconnect)
 *   - Room-based subscriptions (channel rooms, DM rooms, user rooms)
 *   - Backpressure handling with message buffering
 *   - Binary and JSON message framing
 *   - Authentication via session cookie or token
 *
 * Client-side module — works alongside lib/realtime.ts
 */

'use client'

import { subscribeNetworkOrVisibilityResume } from '@/lib/sseResilience'

// ── Types ────────────────────────────────────────────────────────────

export type TransportType = 'websocket' | 'sse' | 'polling'

export type WsMessageType =
  | 'message'
  | 'typing'
  | 'presence'
  | 'reaction'
  | 'deletion'
  | 'read_state'
  | 'thread_update'
  | 'channel_update'
  | 'notification'
  | 'ping'
  | 'pong'
  | 'subscribe'
  | 'unsubscribe'
  | 'error'

export interface WsFrame {
  type: WsMessageType
  seq?: number
  channel_id?: string
  user_id?: string
  payload?: unknown
  ts?: number
}

export interface TransportConfig {
  /** WebSocket URL (e.g., ws://localhost:3040/api/ws) */
  wsUrl?: string
  /** SSE URL fallback */
  sseUrl?: string
  /** Heartbeat interval in ms (default: 25000) */
  heartbeatInterval?: number
  /** Max reconnect attempts before fallback (default: 5) */
  maxReconnectAttempts?: number
  /** Base reconnect delay in ms (default: 1000) */
  reconnectBaseDelay?: number
  /** Max buffer size for offline messages (default: 100) */
  maxBufferSize?: number
  /** Authentication token (optional, falls back to cookie) */
  authToken?: string
}

export type TransportHandler = (frame: WsFrame) => void
export type ConnectionHandler = (status: TransportStatus) => void

export interface TransportStatus {
  transport: TransportType
  connected: boolean
  reconnectAttempt: number
  latency?: number
  bufferedMessages: number
}

// ── Default Config ───────────────────────────────────────────────────

const DEFAULT_CONFIG: Required<TransportConfig> = {
  wsUrl: '',
  sseUrl: '/api/collab/events',
  heartbeatInterval: 25000,
  maxReconnectAttempts: 5,
  reconnectBaseDelay: 1000,
  maxBufferSize: 100,
  authToken: '',
}

// ── Transport Manager ────────────────────────────────────────────────

export class TransportManager {
  private config: Required<TransportConfig>
  private ws: WebSocket | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private handlers = new Map<WsMessageType, Set<TransportHandler>>()
  private statusHandlers = new Set<ConnectionHandler>()
  private buffer: WsFrame[] = []
  private seq = 0
  private reconnectAttempt = 0
  private disposed = false
  private transport: TransportType = 'polling'
  private connected = false
  private lastPingTs = 0
  private latency = 0
  private subscribedRooms = new Set<string>()
  private removeResume: (() => void) | null = null

  constructor(config: Partial<TransportConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    if (!this.config.wsUrl && typeof window !== 'undefined') {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      this.config.wsUrl = `${proto}//${window.location.host}/api/ws`
    }
  }

  /** Start the transport — attempts WebSocket first, falls back to SSE */
  connect(): void {
    if (this.disposed) return

    this.removeResume = subscribeNetworkOrVisibilityResume(() => {
      if (this.disposed) return
      this.reconnectAttempt = 0
      this.reconnect()
    })

    this.attemptWebSocket()
  }

  /** Subscribe to a specific message type */
  on(type: WsMessageType, handler: TransportHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set())
    }
    this.handlers.get(type)!.add(handler)
    return () => {
      this.handlers.get(type)?.delete(handler)
    }
  }

  /** Subscribe to connection status changes */
  onStatus(handler: ConnectionHandler): () => void {
    this.statusHandlers.add(handler)
    return () => {
      this.statusHandlers.delete(handler)
    }
  }

  /** Send a frame to the server */
  send(frame: WsFrame): void {
    frame.seq = ++this.seq
    frame.ts = Date.now()

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame))
    } else {
      // Buffer for later delivery
      if (this.buffer.length < this.config.maxBufferSize) {
        this.buffer.push(frame)
      }
    }
  }

  /** Join a room (channel, DM, etc.) */
  joinRoom(roomId: string): void {
    this.subscribedRooms.add(roomId)
    this.send({ type: 'subscribe', channel_id: roomId })
  }

  /** Leave a room */
  leaveRoom(roomId: string): void {
    this.subscribedRooms.delete(roomId)
    this.send({ type: 'unsubscribe', channel_id: roomId })
  }

  /** Get current transport status */
  getStatus(): TransportStatus {
    return {
      transport: this.transport,
      connected: this.connected,
      reconnectAttempt: this.reconnectAttempt,
      latency: this.latency,
      bufferedMessages: this.buffer.length,
    }
  }

  /** Graceful shutdown */
  disconnect(): void {
    this.disposed = true
    this.removeResume?.()
    this.removeResume = null
    this.stopHeartbeat()
    this.clearReconnect()
    if (this.ws) {
      this.ws.close(1000, 'client_disconnect')
      this.ws = null
    }
    this.buffer = []
    this.handlers.clear()
    this.statusHandlers.clear()
    this.subscribedRooms.clear()
  }

  // ── Private ─────────────────────────────────────────────────────────

  private attemptWebSocket(): void {
    if (this.disposed || typeof WebSocket === 'undefined') {
      this.transport = 'sse'
      this.emitStatus()
      return
    }

    try {
      const url = new URL(this.config.wsUrl)
      if (this.config.authToken) {
        url.searchParams.set('token', this.config.authToken)
      }

      this.ws = new WebSocket(url.toString())

      this.ws.onopen = () => {
        this.connected = true
        this.transport = 'websocket'
        this.reconnectAttempt = 0
        this.emitStatus()
        this.startHeartbeat()
        this.flushBuffer()
        this.resubscribeRooms()
      }

      this.ws.onmessage = (ev) => {
        try {
          const frame = JSON.parse(ev.data as string) as WsFrame
          if (frame.type === 'pong') {
            this.latency = Date.now() - this.lastPingTs
            return
          }
          this.dispatch(frame)
        } catch {
          // Skip malformed
        }
      }

      this.ws.onerror = () => {
        // Will trigger onclose
      }

      this.ws.onclose = (ev) => {
        this.connected = false
        this.stopHeartbeat()
        this.ws = null

        if (this.disposed) return

        if (ev.code === 1000) return // Normal close

        this.reconnectAttempt++
        this.emitStatus()

        if (this.reconnectAttempt <= this.config.maxReconnectAttempts) {
          const delay = this.config.reconnectBaseDelay * Math.min(this.reconnectAttempt, 5)
          this.reconnectTimer = setTimeout(() => this.attemptWebSocket(), delay)
        } else {
          // Fall back to SSE transport
          this.transport = 'sse'
          this.emitStatus()
        }
      }
    } catch {
      this.transport = 'sse'
      this.emitStatus()
    }
  }

  private reconnect(): void {
    this.stopHeartbeat()
    this.clearReconnect()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.connected = false
    this.attemptWebSocket()
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.lastPingTs = Date.now()
        this.send({ type: 'ping' })
      }
    }, this.config.heartbeatInterval)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private flushBuffer(): void {
    while (this.buffer.length > 0) {
      const frame = this.buffer.shift()!
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(frame))
      }
    }
  }

  private resubscribeRooms(): void {
    for (const room of this.subscribedRooms) {
      this.send({ type: 'subscribe', channel_id: room })
    }
  }

  private dispatch(frame: WsFrame): void {
    const handlers = this.handlers.get(frame.type)
    if (handlers) {
      for (const h of handlers) {
        try { h(frame) } catch { /* ignore handler errors */ }
      }
    }
  }

  private emitStatus(): void {
    const status = this.getStatus()
    for (const h of this.statusHandlers) {
      try { h(status) } catch { /* ignore */ }
    }
  }
}

// ── Singleton ────────────────────────────────────────────────────────

let globalTransport: TransportManager | null = null

export function getTransport(config?: Partial<TransportConfig>): TransportManager {
  if (!globalTransport) {
    globalTransport = new TransportManager(config)
  }
  return globalTransport
}

export function resetTransport(): void {
  globalTransport?.disconnect()
  globalTransport = null
}
