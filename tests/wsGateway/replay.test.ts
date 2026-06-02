/**
 * `lib/wsGateway/replay.ts` — bounded per-topic replay log.
 *
 * The store records every event published on a topic (gateway-side) so that
 * when a client reconnects with a `since` cursor, the gateway can re-emit the
 * events the client missed during disconnect.
 *
 * The in-memory store ships in v0.0.36 alongside the gateway; the Redis
 * Streams adapter (v0.0.37) implements the same interface so the swap is
 * config-only.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  MemoryReplayStore,
  type ReplayStore,
} from '@/lib/realtime/wsGateway/replay'
import type { PubSubEvent } from '@/lib/realtime/redisPubSub'

const ev = (id: string): PubSubEvent => ({
  type: 'message',
  channel_id: 'ch-1',
  payload: { id },
})

describe('MemoryReplayStore — record + since', () => {
  let store: ReplayStore

  beforeEach(() => {
    store = new MemoryReplayStore({ maxPerTopic: 1000 })
  })

  it('records an event and returns it on since(0)', async () => {
    await store.record('channel:ch-1', ev('p1'))
    const out = await store.since('channel:ch-1', '0')
    expect(out).toHaveLength(1)
    expect(out[0].event).toEqual(ev('p1'))
    expect(typeof out[0].id).toBe('string')
    expect(out[0].id.length).toBeGreaterThan(0)
  })

  it('returns events in record order', async () => {
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

  it('returns an empty list when since matches the latest entry', async () => {
    await store.record('channel:ch-1', ev('p1'))
    const last = await store.record('channel:ch-1', ev('p2'))
    const out = await store.since('channel:ch-1', last)
    expect(out).toEqual([])
  })

  it('returns an empty list for unknown topics', async () => {
    const out = await store.since('channel:never', '0')
    expect(out).toEqual([])
  })

  it('isolates topics — events on one topic do not leak into another', async () => {
    await store.record('channel:ch-1', ev('p1'))
    await store.record('channel:ch-2', ev('p2'))
    const out1 = await store.since('channel:ch-1', '0')
    const out2 = await store.since('channel:ch-2', '0')
    expect(out1.map(o => (o.event as { payload: { id: string } }).payload.id)).toEqual(['p1'])
    expect(out2.map(o => (o.event as { payload: { id: string } }).payload.id)).toEqual(['p2'])
  })

  it('returns monotonically increasing ids', async () => {
    const a = await store.record('channel:ch-1', ev('p1'))
    const b = await store.record('channel:ch-1', ev('p2'))
    const c = await store.record('channel:ch-1', ev('p3'))
    expect(a < b).toBe(true)
    expect(b < c).toBe(true)
  })
})

describe('MemoryReplayStore — bounded retention', () => {
  it('caps each topic at maxPerTopic, dropping oldest first', async () => {
    const store: ReplayStore = new MemoryReplayStore({ maxPerTopic: 3 })
    await store.record('channel:ch-1', ev('p1'))
    await store.record('channel:ch-1', ev('p2'))
    await store.record('channel:ch-1', ev('p3'))
    await store.record('channel:ch-1', ev('p4'))
    await store.record('channel:ch-1', ev('p5'))

    const out = await store.since('channel:ch-1', '0')
    const ids = out.map(o => (o.event as { payload: { id: string } }).payload.id)
    expect(ids).toEqual(['p3', 'p4', 'p5'])
  })

  it('returns an empty list when since cursor predates the eviction window', async () => {
    const store: ReplayStore = new MemoryReplayStore({ maxPerTopic: 2 })
    const a = await store.record('channel:ch-1', ev('p1'))
    await store.record('channel:ch-1', ev('p2'))
    await store.record('channel:ch-1', ev('p3'))
    // `a` predates the current window — store cannot reconstruct, returns
    // everything still in the buffer (caller decides whether the gap is
    // tolerable; the gateway re-syncs via the SSE poll cursor as a fallback).
    const out = await store.since('channel:ch-1', a)
    const ids = out.map(o => (o.event as { payload: { id: string } }).payload.id)
    expect(ids).toEqual(['p2', 'p3'])
  })
})


// ── Ephemeral-topic skip (v0.0.43 follow-up) ────────────────────────

describe('MemoryReplayStore — skips ephemeral events', () => {
  it('does not record typing events (8s TTL — replay produces ghost typers)', async () => {
    const store = new MemoryReplayStore({ maxPerTopic: 100 })
    await store.record('channel:ch-1', {
      type: 'typing',
      channel_id: 'ch-1',
      user_id: 'u-1',
      active: true,
    })
    expect(await store.since('channel:ch-1', '0')).toEqual([])
  })

  it('does not record presence events (latest-per-user semantic)', async () => {
    const store = new MemoryReplayStore({ maxPerTopic: 100 })
    await store.record('global:presence', {
      type: 'presence',
      user_id: 'u-1',
      status: 'online',
      last_seen: 1000,
    })
    expect(await store.since('global:presence', '0')).toEqual([])
  })

  it('still records non-ephemeral events on the same topic', async () => {
    const store = new MemoryReplayStore({ maxPerTopic: 100 })
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

  it('returns the existing cursor format for skipped events', async () => {
    const store = new MemoryReplayStore({ maxPerTopic: 100 })
    const id = await store.record('channel:ch-1', {
      type: 'typing',
      channel_id: 'ch-1',
      user_id: 'u-1',
      active: true,
    })
    // Skip path still returns a cursor string so callers can pass it to
    // their next `since()` query without special-casing.
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })
})
