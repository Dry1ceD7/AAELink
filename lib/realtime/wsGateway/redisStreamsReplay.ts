/**
 * `lib/wsGateway/redisStreamsReplay.ts` — Redis Streams-backed replay store.
 *
 * Implements the `ReplayStore` interface against Redis Streams so multiple
 * gateway pods share retention. Each topic maps to one stream (key:
 * `${prefix}${topic}`); events are appended with `XADD MAXLEN ~ N` so Redis
 * keeps the buffer roughly capped at `maxPerTopic` per topic.
 *
 * The cursor (`ReplayEntry.id`) is the Redis stream id (`<ms>-<seq>`); callers
 * pass it back into `since()` and the store does an `XRANGE (since +` to get
 * everything strictly after.
 *
 * The `StreamCommands` interface below is the slice of `ioredis`'s commands
 * we touch. The boot script wraps an `ioredis` instance via
 * `wrapIoredisStream(client)` (declared at the bottom of this file). Tests
 * pass a hand-rolled fake.
 */

import type { ReplayEntry, ReplayStore } from '@/lib/realtime/wsGateway/replay'
import { isEphemeralEvent } from '@/lib/realtime/wsGateway/replay'
import type { PubSubEvent } from '@/lib/realtime/redisPubSub'

export interface StreamCommands {
  /** `XADD <key> MAXLEN ~ <maxlen> * <field> <value>` — returns the new id. */
  xadd(key: string, maxlenApprox: number, field: string, value: string): Promise<string>
  /** `XRANGE <key> <start> <end>` — returns `[id, [k,v,k,v,…]]` pairs. */
  xrange(key: string, start: string, end: string): Promise<Array<[string, string[]]>>
}

export interface RedisStreamsReplayStoreOptions {
  stream: StreamCommands
  /** Key prefix; default `aae:replay:` */
  prefix?: string
  /** Approximate per-topic cap; default 1000 */
  maxPerTopic?: number
}

export class RedisStreamsReplayStore implements ReplayStore {
  private readonly stream: StreamCommands
  private readonly prefix: string
  private readonly max: number

  constructor(opts: RedisStreamsReplayStoreOptions) {
    this.stream = opts.stream
    this.prefix = opts.prefix ?? 'aae:replay:'
    this.max = opts.maxPerTopic ?? 1000
  }

  private keyOf(topic: string): string {
    return `${this.prefix}${topic}`
  }

  async record(topic: string, event: PubSubEvent): Promise<string> {
    if (isEphemeralEvent(event)) {
      // Ephemeral events (typing / presence) bypass the replay log — see
      // `lib/wsGateway/replay.ts` for the rationale. Returning a synthetic
      // sentinel keeps the call signature consistent; real callers pass the
      // returned cursor straight back into `since()` and the empty stream
      // gives them an empty replay list.
      return '0-0'
    }
    return await this.stream.xadd(
      this.keyOf(topic),
      this.max,
      'event',
      JSON.stringify(event)
    )
  }

  async since(topic: string, since: string): Promise<ReplayEntry[]> {
    const start = !since || since === '0' ? '-' : nextStreamId(since)
    let entries: Array<[string, string[]]>
    try {
      entries = await this.stream.xrange(this.keyOf(topic), start, '+')
    } catch {
      return []
    }
    const out: ReplayEntry[] = []
    for (const [id, fields] of entries) {
      const value = fieldValue(fields, 'event')
      if (value === null) continue
      try {
        const event = JSON.parse(value) as PubSubEvent
        out.push({ id, event })
      } catch {
        // Malformed entry — skip silently; the store does not block live
        // delivery on stale or corrupt buffer contents.
      }
    }
    return out
  }
}

function fieldValue(fields: string[], key: string): string | null {
  for (let i = 0; i < fields.length - 1; i += 2) {
    if (fields[i] === key) return fields[i + 1]
  }
  return null
}

/**
 * Compute the lexicographically smallest stream id strictly greater than
 * `since`. Redis stream ids are `<ms>-<seq>`; incrementing the seq part is
 * sufficient because Redis enforces id monotonicity per stream.
 */
function nextStreamId(since: string): string {
  const dash = since.lastIndexOf('-')
  if (dash <= 0) return `(${since}`
  const ms = since.slice(0, dash)
  const seq = since.slice(dash + 1)
  const nextSeq = (BigInt(seq) + 1n).toString()
  return `${ms}-${nextSeq}`
}
