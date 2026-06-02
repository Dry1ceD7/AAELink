/**
 * `lib/wsGateway/router.ts` — security hardening: topic allowlist and
 * per-connection rate limiting.
 *
 * The router accepts an optional `security` config; when omitted, behavior
 * matches v0.0.42 (no allowlist, no rate limit). Tests pin the new gates so
 * a future refactor can't drop them silently.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryPubSub } from '@/lib/realtime/redisPubSub'
import {
  createConnection,
  DEFAULT_TOPIC_ALLOWLIST,
  type OutboundSocket,
} from '@/lib/realtime/wsGateway/router'

class CapturingSocket implements OutboundSocket {
  sent: string[] = []
  send(s: string): void { this.sent.push(s) }
  close(): void {}
}

function errorFrames(socket: CapturingSocket) {
  return socket.sent.map(s => JSON.parse(s)).filter(f => f.type === 'error')
}

describe('wsGateway/router — topic allowlist', () => {
  let pubsub: MemoryPubSub
  let socket: CapturingSocket

  beforeEach(() => {
    pubsub = new MemoryPubSub()
    socket = new CapturingSocket()
  })

  it('allows the default channel-prefixed topic', () => {
    const conn = createConnection({ pubsub, socket, userId: 'u-1' })
    conn.handleMessage('{"type":"subscribe","channel_id":"ch-1"}')
    expect(errorFrames(socket).filter(e => e.code === 'topic_not_allowed')).toHaveLength(0)
    expect(conn.subscribedChannels()).toContain('channel:ch-1')
  })

  it('allows the global presence topic by default', () => {
    const conn = createConnection({ pubsub, socket, userId: 'u-1' })
    conn.handleMessage('{"type":"subscribe","topic":"global:presence"}')
    expect(errorFrames(socket).filter(e => e.code === 'topic_not_allowed')).toHaveLength(0)
    expect(conn.subscribedChannels()).toContain('global:presence')
  })

  it('rejects an unknown topic with a topic_not_allowed error', () => {
    const conn = createConnection({ pubsub, socket, userId: 'u-1' })
    conn.handleMessage('{"type":"subscribe","topic":"admin:firehose"}')
    expect(errorFrames(socket).map(e => e.code)).toContain('topic_not_allowed')
    expect(conn.subscribedChannels()).not.toContain('admin:firehose')
  })

  it('honors a custom allowlist when supplied', () => {
    const conn = createConnection({
      pubsub,
      socket,
      userId: 'u-1',
      security: { topicAllowlist: [/^admin:firehose$/] },
    })
    conn.handleMessage('{"type":"subscribe","topic":"admin:firehose"}')
    expect(conn.subscribedChannels()).toContain('admin:firehose')
    socket.sent.length = 0
    conn.handleMessage('{"type":"subscribe","channel_id":"ch-1"}')
    expect(errorFrames(socket).map(e => e.code)).toContain('topic_not_allowed')
  })

  it('exports a non-empty default allowlist for production reuse', () => {
    expect(DEFAULT_TOPIC_ALLOWLIST.length).toBeGreaterThan(0)
    expect(DEFAULT_TOPIC_ALLOWLIST.some(re => re.test('global:presence'))).toBe(true)
    expect(DEFAULT_TOPIC_ALLOWLIST.some(re => re.test('channel:abc-123'))).toBe(true)
    expect(DEFAULT_TOPIC_ALLOWLIST.some(re => re.test('admin:firehose'))).toBe(false)
  })
})

describe('wsGateway/router — per-connection limits', () => {
  let pubsub: MemoryPubSub
  let socket: CapturingSocket

  beforeEach(() => {
    pubsub = new MemoryPubSub()
    socket = new CapturingSocket()
  })

  it('rejects subscribes past the maxSubscriptions cap', () => {
    const conn = createConnection({
      pubsub,
      socket,
      userId: 'u-1',
      security: { maxSubscriptions: 2 },
    })
    conn.handleMessage('{"type":"subscribe","channel_id":"ch-1"}')
    conn.handleMessage('{"type":"subscribe","channel_id":"ch-2"}')
    conn.handleMessage('{"type":"subscribe","channel_id":"ch-3"}')
    const codes = errorFrames(socket).map(e => e.code)
    expect(codes).toContain('subscription_limit')
    expect(conn.subscribedChannels()).toHaveLength(2)
  })

  it('does not count a duplicate subscribe against the cap', () => {
    const conn = createConnection({
      pubsub,
      socket,
      userId: 'u-1',
      security: { maxSubscriptions: 2 },
    })
    conn.handleMessage('{"type":"subscribe","channel_id":"ch-1"}')
    conn.handleMessage('{"type":"subscribe","channel_id":"ch-1"}')
    conn.handleMessage('{"type":"subscribe","channel_id":"ch-2"}')
    expect(errorFrames(socket).map(e => e.code)).not.toContain('subscription_limit')
    expect([...conn.subscribedChannels()].sort()).toEqual(['channel:ch-1', 'channel:ch-2'])
  })

  it('rate-limits inbound frames over the configured threshold', () => {
    const conn = createConnection({
      pubsub,
      socket,
      userId: 'u-1',
      security: { maxFramesPerWindow: 5, frameWindowMs: 1_000 },
    })
    for (let i = 0; i < 10; i += 1) {
      conn.handleMessage('{"type":"ping"}')
    }
    const codes = errorFrames(socket).map(e => e.code)
    expect(codes).toContain('rate_limited')
  })

  it('does not rate-limit when no security config is supplied (back-compat)', () => {
    const conn = createConnection({ pubsub, socket, userId: 'u-1' })
    for (let i = 0; i < 100; i += 1) {
      conn.handleMessage('{"type":"ping"}')
    }
    expect(errorFrames(socket).map(e => e.code)).not.toContain('rate_limited')
  })

  it('allowlist failure does NOT consume a subscription slot', () => {
    const conn = createConnection({
      pubsub,
      socket,
      userId: 'u-1',
      security: { maxSubscriptions: 1 },
    })
    conn.handleMessage('{"type":"subscribe","topic":"admin:firehose"}')
    conn.handleMessage('{"type":"subscribe","channel_id":"ch-1"}')
    expect(conn.subscribedChannels()).toContain('channel:ch-1')
    expect(conn.subscribedChannels()).not.toContain('admin:firehose')
  })
})
