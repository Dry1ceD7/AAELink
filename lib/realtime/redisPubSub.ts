/**
 * AAELink — Redis Pub/Sub Adapter
 *
 * Production-grade fan-out for real-time events:
 *   - Channel-scoped pub/sub for message delivery
 *   - Presence heartbeat distribution across nodes
 *   - Typing indicator fan-out
 *   - Graceful connection management with auto-reconnect
 *   - Serialization/deserialization with type safety
 *   - Works without Redis (in-memory fallback for dev/single-node)
 *
 * This replaces PostgreSQL NOTIFY for horizontal scaling.
 * When Redis is unavailable, falls back to in-process EventEmitter.
 */

import { EventEmitter } from 'events'
import { log } from '@/lib/infra/log'

// ── Types ────────────────────────────────────────────────────────────

export type PubSubEvent =
  | { type: 'message'; channel_id: string; payload: unknown }
  | { type: 'typing'; channel_id: string; user_id: string; active: boolean }
  | { type: 'presence'; user_id: string; status: string; last_seen: number; custom_emoji?: string; custom_text?: string; expires_at?: number }
  | { type: 'reaction'; channel_id: string; message_id: string; emoji: string; user_id: string; action: 'add' | 'remove' }
  | { type: 'deletion'; channel_id: string; message_id: string; deleted_at: number }
  | { type: 'read_state'; channel_id: string; user_id: string; last_read: number }
  | { type: 'thread_update'; channel_id: string; root_id: string; reply_count: number }
  | { type: 'channel_update'; channel_id: string; payload: unknown }
  | { type: 'notification'; user_id: string; payload: unknown }

export type PubSubHandler = (event: PubSubEvent) => void

export interface PubSubAdapter {
  /** Publish an event to a topic */
  publish(topic: string, event: PubSubEvent): Promise<void>
  /** Subscribe to a topic */
  subscribe(topic: string, handler: PubSubHandler): () => void
  /** Subscribe to a pattern (e.g., 'channel:*') */
  psubscribe(pattern: string, handler: PubSubHandler): () => void
  /** Number of active subscriptions */
  subscriptionCount(): number
  /** Graceful shutdown */
  close(): Promise<void>
  /** Whether connected to external broker */
  isConnected(): boolean
  /** Backend type */
  readonly backend: 'redis' | 'memory'
}

// ── Topic Helpers ────────────────────────────────────────────────────

export function channelTopic(channelId: string): string {
  return `channel:${channelId}`
}

export function userTopic(userId: string): string {
  return `user:${userId}`
}

/**
 * Presence fan-out topic. Scoped to a workspace (`presence:<workspaceId>`) so a
 * subscriber only receives presence for its own workspace — no cross-tenant
 * leakage and no global O(users×clients) fan-out. The no-arg form returns the
 * legacy `global:presence` topic, kept only for back-compat / a future opt-in
 * platform-admin view; production presence is always workspace-scoped.
 */
export function presenceTopic(workspaceId?: string): string {
  return workspaceId ? `presence:${workspaceId}` : 'global:presence'
}

export function workspaceTopic(workspaceId: string): string {
  return `workspace:${workspaceId}`
}

// ── In-Memory Adapter (single-node / dev) ────────────────────────────

export class MemoryPubSub implements PubSubAdapter {
  readonly backend = 'memory' as const
  private emitter = new EventEmitter()
  private subs = 0

  constructor() {
    this.emitter.setMaxListeners(10000)
  }

  async publish(topic: string, event: PubSubEvent): Promise<void> {
    this.emitter.emit(topic, event)
    // Also emit to pattern subscribers
    this.emitter.emit(`__pattern__`, { topic, event })
  }

  subscribe(topic: string, handler: PubSubHandler): () => void {
    this.emitter.on(topic, handler)
    this.subs++
    return () => {
      this.emitter.off(topic, handler)
      this.subs--
    }
  }

  psubscribe(pattern: string, handler: PubSubHandler): () => void {
    const regex = new RegExp(
      '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'
    )
    const wrapper = ({ topic, event }: { topic: string; event: PubSubEvent }) => {
      if (regex.test(topic)) handler(event)
    }
    this.emitter.on('__pattern__', wrapper)
    this.subs++
    return () => {
      this.emitter.off('__pattern__', wrapper)
      this.subs--
    }
  }

  subscriptionCount(): number {
    return this.subs
  }

  async close(): Promise<void> {
    this.emitter.removeAllListeners()
    this.subs = 0
  }

  isConnected(): boolean {
    return true // Always "connected" for in-memory
  }
}

// ── Redis Adapter ────────────────────────────────────────────────────

export interface RedisConfig {
  url: string
  /** Key prefix for all pub/sub channels */
  prefix?: string
  /** Reconnect attempts before fallback */
  maxReconnectAttempts?: number
  /** Base delay between reconnects (ms) */
  reconnectBaseDelay?: number
}

/**
 * Redis-backed pub/sub adapter.
 *
 * Requires `ioredis` or compatible client at runtime.
 * Falls back to MemoryPubSub if Redis is unavailable.
 *
 * Usage:
 *   const adapter = await createRedisPubSub({ url: 'redis://localhost:6379' })
 */
export class RedisPubSub implements PubSubAdapter {
  readonly backend = 'redis' as const
  private config: Required<RedisConfig>
  private pubClient: RedisLikeClient | null = null
  private subClient: RedisLikeClient | null = null
  private handlers = new Map<string, Set<PubSubHandler>>()
  private patternHandlers = new Map<string, Set<PubSubHandler>>()
  private connected = false
  private subs = 0

  constructor(config: RedisConfig) {
    this.config = {
      url: config.url,
      prefix: config.prefix || 'aaelink:',
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
      reconnectBaseDelay: config.reconnectBaseDelay ?? 500,
    }
  }

  async connect(createClient: (url: string) => RedisLikeClient | Promise<RedisLikeClient>): Promise<void> {
    try {
      this.pubClient = await createClient(this.config.url)
      this.subClient = await createClient(this.config.url)

      // Wire up message handler on sub client
      this.subClient.onMessage((channel: string, message: string) => {
        const topic = channel.startsWith(this.config.prefix)
          ? channel.slice(this.config.prefix.length)
          : channel

        try {
          const event = JSON.parse(message) as PubSubEvent
          const topicHandlers = this.handlers.get(topic)
          if (topicHandlers) {
            for (const h of topicHandlers) h(event)
          }
          // Check pattern handlers
          for (const [pattern, handlers] of this.patternHandlers) {
            const regex = new RegExp(
              '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'
            )
            if (regex.test(topic)) {
              for (const h of handlers) h(event)
            }
          }
        } catch {
          // Skip malformed messages
        }
      })

      this.connected = true
    } catch {
      this.connected = false
      throw new Error('redis_connection_failed')
    }
  }

  async publish(topic: string, event: PubSubEvent): Promise<void> {
    if (!this.pubClient || !this.connected) {
      throw new Error('redis_not_connected')
    }
    const channel = this.config.prefix + topic
    await this.pubClient.publish(channel, JSON.stringify(event))
  }

  subscribe(topic: string, handler: PubSubHandler): () => void {
    if (!this.handlers.has(topic)) {
      this.handlers.set(topic, new Set())
      // Subscribe on Redis
      const channel = this.config.prefix + topic
      this.subClient?.subscribe(channel)
    }
    this.handlers.get(topic)!.add(handler)
    this.subs++

    return () => {
      const set = this.handlers.get(topic)
      if (set) {
        set.delete(handler)
        if (set.size === 0) {
          this.handlers.delete(topic)
          const channel = this.config.prefix + topic
          this.subClient?.unsubscribe(channel)
        }
      }
      this.subs--
    }
  }

  psubscribe(pattern: string, handler: PubSubHandler): () => void {
    if (!this.patternHandlers.has(pattern)) {
      this.patternHandlers.set(pattern, new Set())
      const channel = this.config.prefix + pattern
      this.subClient?.psubscribe(channel)
    }
    this.patternHandlers.get(pattern)!.add(handler)
    this.subs++

    return () => {
      const set = this.patternHandlers.get(pattern)
      if (set) {
        set.delete(handler)
        if (set.size === 0) {
          this.patternHandlers.delete(pattern)
          const channel = this.config.prefix + pattern
          this.subClient?.punsubscribe(channel)
        }
      }
      this.subs--
    }
  }

  subscriptionCount(): number {
    return this.subs
  }

  async close(): Promise<void> {
    this.connected = false
    await this.subClient?.quit()
    await this.pubClient?.quit()
    this.handlers.clear()
    this.patternHandlers.clear()
    this.subs = 0
  }

  isConnected(): boolean {
    return this.connected
  }
}

// ── Minimal Redis Client Interface ───────────────────────────────────
// (Compatible with ioredis, node-redis, or any wrapper)

export interface RedisLikeClient {
  publish(channel: string, message: string): Promise<number>
  subscribe(channel: string): void
  unsubscribe(channel: string): void
  psubscribe(pattern: string): void
  punsubscribe(pattern: string): void
  onMessage(handler: (channel: string, message: string) => void): void
  quit(): Promise<void>
}

// ── Factory ──────────────────────────────────────────────────────────

let globalAdapter: PubSubAdapter | null = null
/** Promise of the in-flight Redis connect, so concurrent callers share one attempt. */
let pendingRedisConnect: Promise<PubSubAdapter> | null = null

/**
 * Get or create the global PubSub adapter (sync).
 *
 * Returns whatever adapter is currently cached. If `REDIS_URL` is set and we
 * have not yet attempted a connect, this returns the in-memory fallback while
 * a background connect is kicked off; the next call after the connect resolves
 * will return the connected `RedisPubSub`. Callers that *must* wait for the
 * Redis connection should call `getPubSubAsync()` instead.
 */
export function getPubSub(): PubSubAdapter {
  if (!globalAdapter) {
    const redisUrl = typeof process !== 'undefined' ? process.env.REDIS_URL : undefined
    if (redisUrl) {
      // Optimistic memory adapter while the background Redis connect lands.
      // Once the connect resolves, `getPubSub()` returns the Redis adapter.
      globalAdapter = new MemoryPubSub()
      void connectRedisInBackground(redisUrl)
    } else {
      globalAdapter = new MemoryPubSub()
    }
  }
  return globalAdapter
}

/**
 * Async variant — waits for the in-flight Redis connect (if any) before
 * returning. Resolves to a connected `RedisPubSub` when `REDIS_URL` is set and
 * the `ioredis` package is available, otherwise resolves to a `MemoryPubSub`
 * fallback. Callers in performance-sensitive paths should prefer `getPubSub()`.
 */
export async function getPubSubAsync(): Promise<PubSubAdapter> {
  const adapter = getPubSub()
  if (adapter.backend === 'memory' && pendingRedisConnect) {
    return pendingRedisConnect
  }
  return adapter
}

async function connectRedisInBackground(url: string): Promise<PubSubAdapter> {
  if (pendingRedisConnect) return pendingRedisConnect

  pendingRedisConnect = (async () => {
    try {
      const { defaultRedisClientFactory } = await import('@/lib/realtime/redisClientFactory')
      const redis = new RedisPubSub({ url })
      await redis.connect(async u => await defaultRedisClientFactory(u))
      // Swap the global adapter in place — subsequent `getPubSub()` callers
      // see the connected Redis adapter.
      globalAdapter = redis
      return redis
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown'
      // One-time warning; keep the memory fallback so the app stays up.
      log.warn('falling back to in-process MemoryPubSub', { name: 'redisPubSub.connect', reason })
      // globalAdapter already set to MemoryPubSub by the sync getPubSub() call.
      return globalAdapter ?? new MemoryPubSub()
    } finally {
      pendingRedisConnect = null
    }
  })()

  return pendingRedisConnect
}

/** Reset global adapter (for testing) */
export function resetPubSub(): void {
  globalAdapter?.close()
  globalAdapter = null
  pendingRedisConnect = null
}
