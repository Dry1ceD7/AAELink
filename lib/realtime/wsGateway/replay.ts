/**
 * `lib/wsGateway/replay.ts` — bounded per-topic replay log for the WebSocket
 * gateway.
 *
 * When a client reconnects with a `since` cursor, the gateway calls
 * `store.since(topic, cursor)` to re-emit the events the client missed during
 * disconnect. Two implementations:
 *
 * - `MemoryReplayStore` — in-process, single-gateway-pod retention; default
 *   eviction is "oldest-first when over `maxPerTopic`".
 * - (planned, v0.0.37) `RedisStreamsReplayStore` — Redis Streams-backed,
 *   shared across gateway pods, supports `XADD MAXLEN ~ N` for the same
 *   bounded retention semantics.
 *
 * The interface is async so the same call shape works for both backends.
 *
 * Cursor format: opaque string. Callers must not parse the value; treat it as
 * a token to pass back into `since()`. The memory store uses a monotonic
 * counter encoded as a fixed-width zero-padded string so lexicographic order
 * matches insertion order.
 */

import type { PubSubEvent } from '@/lib/realtime/redisPubSub'

export interface ReplayEntry {
  /** Opaque cursor that callers pass into a future `since()` call. */
  id: string
  event: PubSubEvent
}

export interface ReplayStore {
  /**
   * Append an event to the topic. Returns the new cursor — callers pass this
   * to clients so they can resume from after this entry.
   */
  record(topic: string, event: PubSubEvent): Promise<string>

  /**
   * Return all entries on `topic` with `id > since`. If `since` is `'0'` or
   * predates the retention window, returns whatever is currently buffered.
   */
  since(topic: string, since: string): Promise<ReplayEntry[]>
}

export interface MemoryReplayStoreOptions {
  /** Per-topic ring-buffer size. Default 1000. */
  maxPerTopic?: number
}

/**
 * Ephemeral event types are not recorded by the replay store. Replaying these
 * on reconnect would surface stale state to the client:
 *
 * - `typing` — 8s TTL on the consumer side; older entries become "ghost
 *   typers" indistinguishable from active ones.
 * - `presence` — latest-per-user semantic; an out-of-order replay can regress
 *   a user's last-seen timestamp.
 *
 * The router's live subscribe path still receives these events. Only the
 * persisted replay log skips them.
 */
const EPHEMERAL_EVENT_TYPES: ReadonlySet<PubSubEvent['type']> = new Set([
  'typing',
  'presence',
])

export function isEphemeralEvent(event: PubSubEvent): boolean {
  return EPHEMERAL_EVENT_TYPES.has(event.type)
}

export class MemoryReplayStore implements ReplayStore {
  private buffers = new Map<string, ReplayEntry[]>()
  private counter = 0n
  private readonly max: number

  constructor(opts: MemoryReplayStoreOptions = {}) {
    this.max = opts.maxPerTopic ?? 1000
  }

  async record(topic: string, event: PubSubEvent): Promise<string> {
    this.counter += 1n
    const id = encodeCursor(this.counter)
    if (isEphemeralEvent(event)) {
      // Advance the cursor so caller-visible ids stay monotonic, but do not
      // persist the event — see EPHEMERAL_EVENT_TYPES doc above.
      return id
    }
    let buf = this.buffers.get(topic)
    if (!buf) {
      buf = []
      this.buffers.set(topic, buf)
    }
    buf.push({ id, event })
    if (buf.length > this.max) {
      buf.splice(0, buf.length - this.max)
    }
    return id
  }

  async since(topic: string, since: string): Promise<ReplayEntry[]> {
    const buf = this.buffers.get(topic)
    if (!buf) return []
    if (!since || since === '0') return buf.slice()
    return buf.filter(e => e.id > since)
  }
}

/**
 * Format the monotonic counter as a 24-char zero-padded decimal string. 24
 * digits is enough for 10^24 events (≫ everything we'll ever record); the
 * fixed width preserves lexicographic ordering across the entire counter
 * range.
 */
function encodeCursor(n: bigint): string {
  return n.toString().padStart(24, '0')
}
