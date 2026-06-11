/**
 * `lib/wsGateway/redisStreamsReplay.ts` — Redis Streams-backed replay store.
 *
 * Tests use a fake `StreamCommands` object so we don't need a live Redis
 * instance. The fake mirrors the subset of `XADD MAXLEN ~`, `XRANGE` we
 * actually use; the production code passes through whatever ioredis returns.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  RedisStreamsReplayStore,
  type StreamCommands,
} from '@/lib/realtime/wsGateway/redisStreamsReplay'
import type { PubSubEvent } from '@/lib/realtime/redisPubSub'

const ev = (id: string): PubSubEvent => ({
  type: 'message',
  channel_id: 'ch-1',
  payload: { id },
})

class FakeStream implements StreamCommands {
  /** stream-key → list of [id, [k,v,k,v,…]] pairs */
  private streams = new Map<string, Array<[string, string[]]>>()
  private counter = 0

  async xadd(
    key: string,
    maxlenApprox: number,
    field: string,
    value: string
  ): Promise<string> {
    this.counter += 1
    const id = `0-${this.counter}`
    let list = this.streams.get(key)
    if (!list) {
      list = []
      this.streams.set(key, list)
    }
    list.push([id, [field, value]])
    // Approximate trim: drop from front until length <= maxlenApprox.
    while (list.length > maxlenApprox) list.shift()
    return id
  }

  async xrange(
    key: string,
    start: string,
    end: string
  ): Promise<Array<[string, string[]]>> {
    const list = this.streams.get(key) || []
    return list.filter(([id]) => idGte(id, start) && idLte(id, end))
  }
}

function idGte(a: string, b: string): boolean {
  if (b === '-' || b === '0') return true
  return a >= b
}
function idLte(a: string, b: string): boolean {
  if (b === '+') return true
  return a <= b
}

describe('RedisStreamsReplayStore — basic record + since', () => {
  let stream: FakeStream
  let store: RedisStreamsReplayStore

  beforeEach(() => {
    stream = new FakeStream()
    store = new RedisStreamsReplayStore({ stream, prefix: 'aae:replay:', maxPerTopic: 100 })
  })

  it('records an event and returns it on since(0)', async () => {
    await store.record('channel:ch-1', ev('p1'))
    const out = await store.since('channel:ch-1', '0')
    expect(out).toHaveLength(1)
    expect(out[0].event).toEqual(ev('p1'))
  })

  it('preserves record order', async () => {
    await store.record('channel:ch-1', ev('p1'))
    await store.record('channel:ch-1', ev('p2'))
    await store.record('channel:ch-1', ev('p3'))
    const out = await store.since('channel:ch-1', '0')
    const ids = out.map(o => (o.event as { payload: { id: string } }).payload.id)
    expect(ids).toEqual(['p1', 'p2', 'p3'])
  })

  it('returns only events after the since cursor', async () => {
    const a = await store.record('channel:ch-1', ev('p1'))
    await store.record('channel:ch-1', ev('p2'))
    await store.record('channel:ch-1', ev('p3'))
    const out = await store.since('channel:ch-1', a)
    const ids = out.map(o => (o.event as { payload: { id: string } }).payload.id)
    expect(ids).toEqual(['p2', 'p3'])
  })

  it('isolates topics — events on one topic do not leak into another', async () => {
    await store.record('channel:ch-1', ev('p1'))
    await store.record('channel:ch-2', ev('p2'))
    const out1 = await store.since('channel:ch-1', '0')
    const out2 = await store.since('channel:ch-2', '0')
    expect(out1).toHaveLength(1)
    expect(out2).toHaveLength(1)
  })

  it('returns empty list for unknown topics', async () => {
    const out = await store.since('channel:never', '0')
    expect(out).toEqual([])
  })
})

describe('RedisStreamsReplayStore — bounded retention', () => {
  it('caps each topic at maxPerTopic via approximate trim', async () => {
    const stream = new FakeStream()
    const store = new RedisStreamsReplayStore({
      stream,
      prefix: 'aae:replay:',
      maxPerTopic: 3,
    })
    await store.record('channel:ch-1', ev('p1'))
    await store.record('channel:ch-1', ev('p2'))
    await store.record('channel:ch-1', ev('p3'))
    await store.record('channel:ch-1', ev('p4'))
    await store.record('channel:ch-1', ev('p5'))

    const out = await store.since('channel:ch-1', '0')
    const ids = out.map(o => (o.event as { payload: { id: string } }).payload.id)
    // Approximate trim — exact retention is implementation-defined, but the
    // store must never grow unboundedly. The fake trims exactly; real Redis
    // may keep slightly more. Check the ceiling.
    expect(ids.length).toBeLessThanOrEqual(3)
    expect(ids).toContain('p5') // newest must always be present
  })
})

describe('RedisStreamsReplayStore — error tolerance', () => {
  it('treats malformed event JSON as a no-op (returns empty list)', async () => {
    const stream = new FakeStream()
    // Manually inject a malformed entry into the underlying stream.
    await stream.xadd('aae:replay:channel:ch-1', 100, 'event', 'not json')
    const store = new RedisStreamsReplayStore({
      stream,
      prefix: 'aae:replay:',
      maxPerTopic: 100,
    })
    const out = await store.since('channel:ch-1', '0')
    expect(out).toEqual([])
  })
})


// ── Ephemeral-topic skip (v0.0.43 follow-up) ────────────────────────

describe('RedisStreamsReplayStore — skips ephemeral events', () => {
  it('does not call xadd for typing events', async () => {
    const stream = new FakeStream()
    const xaddSpy = stream.xadd.bind(stream)
    let xaddCalls = 0
    stream.xadd = async (...args: Parameters<StreamCommands['xadd']>) => {
      xaddCalls += 1
      return xaddSpy(...args)
    }
    const store = new RedisStreamsReplayStore({
      stream,
      prefix: 'aae:replay:',
      maxPerTopic: 100,
    })
    await store.record('channel:ch-1', {
      type: 'typing',
      channel_id: 'ch-1',
      user_id: 'u-1',
      active: true,
    })
    expect(xaddCalls).toBe(0)
    expect(await store.since('channel:ch-1', '0')).toEqual([])
  })

  it('does not call xadd for presence events', async () => {
    const stream = new FakeStream()
    let xaddCalls = 0
    const realXadd = stream.xadd.bind(stream)
    stream.xadd = async (...args: Parameters<StreamCommands['xadd']>) => {
      xaddCalls += 1
      return realXadd(...args)
    }
    const store = new RedisStreamsReplayStore({
      stream,
      prefix: 'aae:replay:',
      maxPerTopic: 100,
    })
    await store.record('global:presence', {
      type: 'presence',
      user_id: 'u-1',
      status: 'online',
      last_seen: 1000,
    })
    expect(xaddCalls).toBe(0)
  })

  it('still records non-ephemeral events on the same topic', async () => {
    const stream = new FakeStream()
    const store = new RedisStreamsReplayStore({
      stream,
      prefix: 'aae:replay:',
      maxPerTopic: 100,
    })
    await store.record('channel:ch-1', {
      type: 'typing',
      channel_id: 'ch-1',
      user_id: 'u-1',
      active: true,
    })
    await store.record('channel:ch-1', ev('p1'))
    const out = await store.since('channel:ch-1', '0')
    expect(out).toHaveLength(1)
    expect(out[0].event.type).toBe('message')
  })
})
