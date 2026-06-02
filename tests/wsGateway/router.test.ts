/**
 * `lib/wsGateway/router.ts` — per-connection state + Redis fan-out.
 *
 * The router accepts an injected `PubSubAdapter` so tests can use the
 * `MemoryPubSub` from `lib/redisPubSub.ts` directly — no real Redis needed.
 * The "WebSocket" is also injected as a minimal `OutboundSocket` interface so
 * we don't have to spin up a real `ws` server.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryPubSub } from '@/lib/realtime/redisPubSub'
import {
  createConnection,
  type OutboundSocket,
} from '@/lib/realtime/wsGateway/router'

class CapturingSocket implements OutboundSocket {
  sent: string[] = []
  closed = false
  send(message: string): void {
    this.sent.push(message)
  }
  close(): void {
    this.closed = true
  }
}

describe('wsGateway/router — createConnection', () => {
  let pubsub: MemoryPubSub
  let socket: CapturingSocket

  beforeEach(() => {
    pubsub = new MemoryPubSub()
    socket = new CapturingSocket()
  })

  it('emits a hello frame on creation', () => {
    createConnection({ pubsub, socket, userId: 'u-1' })
    const frames = socket.sent.map(s => JSON.parse(s))
    expect(frames).toContainEqual({ type: 'hello', user_id: 'u-1' })
  })

  it('responds to a ping with a pong', () => {
    const conn = createConnection({ pubsub, socket, userId: 'u-1' })
    conn.handleMessage('{"type":"ping"}')
    const frames = socket.sent.map(s => JSON.parse(s))
    expect(frames).toContainEqual({ type: 'pong' })
  })

  it('sends an error frame for malformed input without disconnecting', () => {
    const conn = createConnection({ pubsub, socket, userId: 'u-1' })
    conn.handleMessage('not json')
    const frames = socket.sent.map(s => JSON.parse(s))
    expect(frames.some(f => f.type === 'error')).toBe(true)
    expect(socket.closed).toBe(false)
  })

  it('forwards published events on subscribed channels', async () => {
    const conn = createConnection({ pubsub, socket, userId: 'u-1' })
    conn.handleMessage('{"type":"subscribe","channel_id":"ch-1"}')
    socket.sent.length = 0 // clear prior frames

    await pubsub.publish('channel:ch-1', {
      type: 'message',
      channel_id: 'ch-1',
      payload: { id: 'p1' },
    })

    const events = socket.sent
      .map(s => JSON.parse(s))
      .filter(f => f.type === 'event')
    expect(events).toHaveLength(1)
    expect(events[0].topic).toBe('channel:ch-1')
    expect(events[0].payload.payload.id).toBe('p1')
  })

  it('does not forward events from unsubscribed channels', async () => {
    const conn = createConnection({ pubsub, socket, userId: 'u-1' })
    conn.handleMessage('{"type":"subscribe","channel_id":"ch-1"}')
    socket.sent.length = 0

    await pubsub.publish('channel:ch-2', {
      type: 'message',
      channel_id: 'ch-2',
      payload: { id: 'q1' },
    })

    const events = socket.sent
      .map(s => JSON.parse(s))
      .filter(f => f.type === 'event')
    expect(events).toHaveLength(0)
  })

  it('stops forwarding after unsubscribe', async () => {
    const conn = createConnection({ pubsub, socket, userId: 'u-1' })
    conn.handleMessage('{"type":"subscribe","channel_id":"ch-1"}')
    conn.handleMessage('{"type":"unsubscribe","channel_id":"ch-1"}')
    socket.sent.length = 0

    await pubsub.publish('channel:ch-1', {
      type: 'message',
      channel_id: 'ch-1',
      payload: { id: 'p1' },
    })

    const events = socket.sent
      .map(s => JSON.parse(s))
      .filter(f => f.type === 'event')
    expect(events).toHaveLength(0)
  })

  it('detaches all subscriptions on close', async () => {
    const conn = createConnection({ pubsub, socket, userId: 'u-1' })
    conn.handleMessage('{"type":"subscribe","channel_id":"ch-1"}')
    conn.handleMessage('{"type":"subscribe","channel_id":"ch-2"}')

    conn.close()
    socket.sent.length = 0

    await pubsub.publish('channel:ch-1', {
      type: 'message',
      channel_id: 'ch-1',
      payload: {},
    })
    await pubsub.publish('channel:ch-2', {
      type: 'message',
      channel_id: 'ch-2',
      payload: {},
    })

    const events = socket.sent
      .map(s => JSON.parse(s))
      .filter(f => f.type === 'event')
    expect(events).toHaveLength(0)
  })

  it('subscribes idempotently — duplicate subscribe is a no-op', async () => {
    const conn = createConnection({ pubsub, socket, userId: 'u-1' })
    conn.handleMessage('{"type":"subscribe","channel_id":"ch-1"}')
    conn.handleMessage('{"type":"subscribe","channel_id":"ch-1"}')
    socket.sent.length = 0

    await pubsub.publish('channel:ch-1', {
      type: 'message',
      channel_id: 'ch-1',
      payload: { id: 'p1' },
    })

    const events = socket.sent
      .map(s => JSON.parse(s))
      .filter(f => f.type === 'event')
    expect(events).toHaveLength(1)
  })

  // ── Topic-keyed subscribe (ADR-0002) ─────────────────────────────

  it('forwards events on a topic-keyed subscribe verbatim', async () => {
    const conn = createConnection({ pubsub, socket, userId: 'u-1' })
    conn.handleMessage('{"type":"subscribe","topic":"global:presence"}')
    socket.sent.length = 0

    await pubsub.publish('global:presence', {
      type: 'presence',
      user_id: 'u-1',
      status: 'online',
      last_seen: 1000,
    })

    const events = socket.sent
      .map(s => JSON.parse(s))
      .filter(f => f.type === 'event')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'event',
      topic: 'global:presence',
      payload: { type: 'presence', user_id: 'u-1', status: 'online' },
    })
    expect(conn.subscribedChannels()).toContain('global:presence')
  })

  it('topic-keyed unsubscribe stops forwarding', async () => {
    const conn = createConnection({ pubsub, socket, userId: 'u-1' })
    conn.handleMessage('{"type":"subscribe","topic":"global:presence"}')
    conn.handleMessage('{"type":"unsubscribe","topic":"global:presence"}')
    socket.sent.length = 0

    await pubsub.publish('global:presence', {
      type: 'presence',
      user_id: 'u-2',
      status: 'away',
      last_seen: 2000,
    })

    const events = socket.sent
      .map(s => JSON.parse(s))
      .filter(f => f.type === 'event')
    expect(events).toHaveLength(0)
    expect(conn.subscribedChannels()).not.toContain('global:presence')
  })
})


// ── Replay-on-reconnect ─────────────────────────────────────────────

import { MemoryReplayStore } from '@/lib/realtime/wsGateway/replay'
import { channelTopic } from '@/lib/realtime/redisPubSub'

describe('wsGateway/router — replay-on-reconnect', () => {
  let pubsub: MemoryPubSub
  let replay: MemoryReplayStore
  let socket: CapturingSocket

  beforeEach(() => {
    pubsub = new MemoryPubSub()
    replay = new MemoryReplayStore({ maxPerTopic: 100 })
    socket = new CapturingSocket()
  })

  it('flushes missed events from the replay store on subscribe(since)', async () => {
    // Pre-populate the replay store as if events had been recorded while the
    // client was disconnected.
    const topic = channelTopic('ch-1')
    await replay.record(topic, { type: 'message', channel_id: 'ch-1', payload: { id: 'p1' } })
    await replay.record(topic, { type: 'message', channel_id: 'ch-1', payload: { id: 'p2' } })

    const conn = createConnection({ pubsub, socket, userId: 'u-1', replay })
    conn.handleMessage('{"type":"subscribe","channel_id":"ch-1","since":"0"}')

    // Allow the async replay flush to settle.
    await new Promise(resolve => setTimeout(resolve, 0))

    const replayFrames = socket.sent
      .map(s => JSON.parse(s))
      .filter(f => f.type === 'event' && f.replay === true)
    expect(replayFrames).toHaveLength(2)
    const ids = replayFrames.map(f => f.payload.payload.id)
    expect(ids).toEqual(['p1', 'p2'])
  })

  it('does not replay when subscribe has no since cursor', async () => {
    const topic = channelTopic('ch-1')
    await replay.record(topic, { type: 'message', channel_id: 'ch-1', payload: { id: 'p1' } })

    const conn = createConnection({ pubsub, socket, userId: 'u-1', replay })
    conn.handleMessage('{"type":"subscribe","channel_id":"ch-1"}')
    await new Promise(resolve => setTimeout(resolve, 0))

    const replayFrames = socket.sent
      .map(s => JSON.parse(s))
      .filter(f => f.type === 'event' && f.replay === true)
    expect(replayFrames).toHaveLength(0)
  })

  it('still forwards live events after the replay flush completes', async () => {
    const topic = channelTopic('ch-1')
    await replay.record(topic, { type: 'message', channel_id: 'ch-1', payload: { id: 'p1' } })

    const conn = createConnection({ pubsub, socket, userId: 'u-1', replay })
    conn.handleMessage('{"type":"subscribe","channel_id":"ch-1","since":"0"}')
    await new Promise(resolve => setTimeout(resolve, 0))

    socket.sent.length = 0
    await pubsub.publish(topic, { type: 'message', channel_id: 'ch-1', payload: { id: 'p2' } })

    const liveFrames = socket.sent
      .map(s => JSON.parse(s))
      .filter(f => f.type === 'event' && f.replay !== true)
    expect(liveFrames).toHaveLength(1)
    expect(liveFrames[0].payload.payload.id).toBe('p2')
  })

  it('skips replay cleanly when the store is omitted', async () => {
    const conn = createConnection({ pubsub, socket, userId: 'u-1' })
    conn.handleMessage('{"type":"subscribe","channel_id":"ch-1","since":"abc"}')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(conn.subscribedChannels()).toContain(channelTopic('ch-1'))
  })
})
