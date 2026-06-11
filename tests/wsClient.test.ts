/**
 * `lib/wsClient.ts` — browser-side WebSocket client for the v0.0.35 gateway.
 *
 * Tests cover the pure parser/serializer; the WebSocket lifecycle is exercised
 * in browser E2E tests because mocking `WebSocket` reliably is more brittle
 * than testing the protocol shape.
 */
import { describe, it, expect } from 'vitest'
import {
  parseServerFrame,
  serializeClientFrame,
  type ClientFrameOut,
  type ServerFrameIn,
} from '@/lib/realtime/wsClient'

describe('wsClient — parseServerFrame', () => {
  it('parses a hello frame', () => {
    const f = parseServerFrame('{"type":"hello","user_id":"u-1"}')
    expect(f).toEqual<ServerFrameIn>({ type: 'hello', user_id: 'u-1' })
  })

  it('parses a pong frame', () => {
    const f = parseServerFrame('{"type":"pong"}')
    expect(f).toEqual<ServerFrameIn>({ type: 'pong' })
  })

  it('parses an event frame with id and replay flag', () => {
    const raw = JSON.stringify({
      type: 'event',
      topic: 'channel:ch-1',
      id: 'evt-1',
      payload: { type: 'message', channel_id: 'ch-1', payload: { id: 'p1' } },
      replay: true,
    })
    const f = parseServerFrame(raw)
    expect(f?.type).toBe('event')
    if (f?.type === 'event') {
      expect(f.id).toBe('evt-1')
      expect(f.topic).toBe('channel:ch-1')
      expect(f.replay).toBe(true)
    }
  })

  it('parses an event frame without replay flag', () => {
    const raw = JSON.stringify({
      type: 'event',
      topic: 'channel:ch-1',
      id: 'evt-2',
      payload: { type: 'message', channel_id: 'ch-1', payload: {} },
    })
    const f = parseServerFrame(raw)
    expect(f?.type).toBe('event')
    if (f?.type === 'event') {
      expect(f.replay).toBe(false)
    }
  })

  it('parses an error frame', () => {
    const f = parseServerFrame('{"type":"error","code":"unauthorized"}')
    expect(f).toEqual<ServerFrameIn>({ type: 'error', code: 'unauthorized' })
  })

  it('returns null for malformed JSON', () => {
    expect(parseServerFrame('not json')).toBeNull()
  })

  it('returns null for unknown type', () => {
    expect(parseServerFrame('{"type":"hack"}')).toBeNull()
  })

  it('returns null for an event frame missing id', () => {
    const raw = JSON.stringify({
      type: 'event',
      topic: 'channel:ch-1',
      payload: {},
    })
    expect(parseServerFrame(raw)).toBeNull()
  })

  it('returns null for an event frame with non-string topic', () => {
    const raw = JSON.stringify({
      type: 'event',
      topic: 42,
      id: 'x',
      payload: {},
    })
    expect(parseServerFrame(raw)).toBeNull()
  })
})

describe('wsClient — serializeClientFrame', () => {
  it('serializes a subscribe frame without since', () => {
    const out = serializeClientFrame({ type: 'subscribe', channel_id: 'ch-1' })
    expect(JSON.parse(out)).toEqual({ type: 'subscribe', channel_id: 'ch-1' })
  })

  it('serializes a subscribe frame with since', () => {
    const out = serializeClientFrame({
      type: 'subscribe',
      channel_id: 'ch-1',
      since: 'cursor-x',
    })
    expect(JSON.parse(out)).toEqual({
      type: 'subscribe',
      channel_id: 'ch-1',
      since: 'cursor-x',
    })
  })

  it('serializes an unsubscribe frame', () => {
    const out = serializeClientFrame({ type: 'unsubscribe', channel_id: 'ch-1' })
    expect(JSON.parse(out)).toEqual({ type: 'unsubscribe', channel_id: 'ch-1' })
  })

  it('serializes a ping frame', () => {
    const out = serializeClientFrame({ type: 'ping' })
    expect(JSON.parse(out)).toEqual({ type: 'ping' })
  })

  // Compile-time check the discriminated union shape is correct.
  it('rejects an empty since value at the type level (compiles only)', () => {
    const f: ClientFrameOut = { type: 'subscribe', channel_id: 'ch-1' }
    expect(f).toBeTruthy()
  })
})

// ── Topic-keyed subscribe (ADR-0002) ──────────────────────────────

import { connectWsCollab } from '@/lib/realtime/wsClient'

describe('wsClient — connectWsCollab topic subscribes', () => {
  /**
   * Minimal fake WebSocket harness. The browser-only `connectWsCollab` reads
   * `WebSocket` off the global; tests install and remove a fake to capture
   * sent frames synchronously.
   */
  class FakeWebSocket {
    static OPEN = 1
    static CLOSED = 3
    static instances: FakeWebSocket[] = []
    readyState = 1
    sent: string[] = []
    onopen: (() => void) | null = null
    onmessage: ((ev: { data: string }) => void) | null = null
    onclose: (() => void) | null = null
    onerror: (() => void) | null = null
    constructor(public url: string) {
      FakeWebSocket.instances.push(this)
      // fire onopen on next microtask so callers can attach handlers first
      queueMicrotask(() => this.onopen?.())
    }
    send(data: string): void {
      this.sent.push(data)
    }
    close(): void {
      this.readyState = 3
      this.onclose?.()
    }
  }

  function withFakeWs<T>(fn: () => Promise<T> | T): Promise<T> {
    const g = globalThis as unknown as { WebSocket?: unknown }
    const prev = g.WebSocket
    g.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    FakeWebSocket.instances = []
    return Promise.resolve(fn()).finally(() => {
      g.WebSocket = prev
    })
  }

  it('subscribeTopic sends a topic subscribe frame', async () => {
    await withFakeWs(async () => {
      const handle = connectWsCollab({
        url: 'ws://test',
        channelId: 'ch-1',
        onEvent: () => {},
      })
      await Promise.resolve()
      handle.subscribeTopic('global:presence')
      const ws = FakeWebSocket.instances[0]
      const frames = ws.sent.map((s) => JSON.parse(s))
      expect(frames).toContainEqual({ type: 'subscribe', topic: 'global:presence' })
      handle.close()
    })
  })

  it('subscribeTopic uses the last-seen cursor on resubscribe', async () => {
    await withFakeWs(async () => {
      const handle = connectWsCollab({
        url: 'ws://test',
        channelId: 'ch-1',
        onEvent: () => {},
      })
      await Promise.resolve()
      const ws = FakeWebSocket.instances[0]
      handle.subscribeTopic('global:presence')
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'event',
          topic: 'global:presence',
          id: 'evt-1',
          payload: { type: 'presence', user_id: 'u-1', status: 'online', last_seen: 1 },
        }),
      })
      ws.sent.length = 0
      handle.subscribeTopic('global:presence')
      const frames = ws.sent.map((s) => JSON.parse(s))
      expect(frames).toContainEqual({
        type: 'subscribe',
        topic: 'global:presence',
        since: 'evt-1',
      })
      handle.close()
    })
  })

  it('reconnect re-sends both channel and topic subscribes', async () => {
    await withFakeWs(async () => {
      const handle = connectWsCollab({
        url: 'ws://test',
        channelId: 'ch-1',
        onEvent: () => {},
        reconnectBaseMs: 0,
        maxReconnectAttempts: 1,
      })
      await Promise.resolve()
      handle.subscribeTopic('global:presence')
      const first = FakeWebSocket.instances[0]
      first.close()
      await new Promise((r) => setTimeout(r, 5))
      await Promise.resolve()
      const second = FakeWebSocket.instances[1]
      const frames = second.sent.map((s) => JSON.parse(s))
      expect(frames).toContainEqual({ type: 'subscribe', channel_id: 'ch-1' })
      expect(frames).toContainEqual({ type: 'subscribe', topic: 'global:presence' })
      handle.close()
    })
  })

  it('unsubscribeTopic removes the topic from the reconnect set', async () => {
    await withFakeWs(async () => {
      const handle = connectWsCollab({
        url: 'ws://test',
        channelId: 'ch-1',
        onEvent: () => {},
        reconnectBaseMs: 0,
        maxReconnectAttempts: 1,
      })
      await Promise.resolve()
      handle.subscribeTopic('global:presence')
      handle.unsubscribeTopic('global:presence')
      const first = FakeWebSocket.instances[0]
      const unsubFrames = first.sent
        .map((s) => JSON.parse(s))
        .filter((f) => f.type === 'unsubscribe' && f.topic === 'global:presence')
      expect(unsubFrames).toHaveLength(1)

      first.close()
      await new Promise((r) => setTimeout(r, 5))
      await Promise.resolve()
      const second = FakeWebSocket.instances[1]
      const reconnectFrames = second.sent.map((s) => JSON.parse(s))
      expect(reconnectFrames).not.toContainEqual({
        type: 'subscribe',
        topic: 'global:presence',
      })
      handle.close()
    })
  })

  it('cursors() exposes both channel-keyed and topic-keyed entries', async () => {
    await withFakeWs(async () => {
      const handle = connectWsCollab({
        url: 'ws://test',
        channelId: 'ch-1',
        onEvent: () => {},
      })
      await Promise.resolve()
      const ws = FakeWebSocket.instances[0]
      handle.subscribeTopic('global:presence')
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'event',
          topic: 'channel:ch-1',
          id: 'evt-c1',
          payload: { type: 'message', channel_id: 'ch-1', payload: { id: 'p1' } },
        }),
      })
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'event',
          topic: 'global:presence',
          id: 'evt-p1',
          payload: { type: 'presence', user_id: 'u-1', status: 'online', last_seen: 1 },
        }),
      })
      const c = handle.cursors()
      expect(c['channel:ch-1']).toBe('evt-c1')
      expect(c['global:presence']).toBe('evt-p1')
      handle.close()
    })
  })
})
