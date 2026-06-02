/**
 * AAELink — Redis Pub/Sub Adapter Tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  MemoryPubSub,
  RedisPubSub,
  channelTopic,
  userTopic,
  presenceTopic,
  workspaceTopic,
  getPubSub,
  resetPubSub,
  type PubSubEvent,
} from '@/lib/realtime/redisPubSub'

// ── Topic Helpers ────────────────────────────────────────────────────

describe('PubSub — Topic Helpers', () => {
  it('generates channel topics', () => {
    expect(channelTopic('ch-1')).toBe('channel:ch-1')
  })

  it('generates user topics', () => {
    expect(userTopic('user-1')).toBe('user:user-1')
  })

  it('generates presence topic', () => {
    expect(presenceTopic()).toBe('global:presence')
  })

  it('generates workspace topics', () => {
    expect(workspaceTopic('ws-1')).toBe('workspace:ws-1')
  })
})

// ── Memory Adapter ───────────────────────────────────────────────────

describe('PubSub — MemoryPubSub', () => {
  let adapter: MemoryPubSub

  beforeEach(() => {
    adapter = new MemoryPubSub()
  })

  afterEach(async () => {
    await adapter.close()
  })

  it('reports memory backend', () => {
    expect(adapter.backend).toBe('memory')
    expect(adapter.isConnected()).toBe(true)
  })

  it('publishes and receives messages', async () => {
    const received: PubSubEvent[] = []
    adapter.subscribe('test', (e) => received.push(e))

    const event: PubSubEvent = { type: 'message', channel_id: 'ch-1', payload: { text: 'hello' } }
    await adapter.publish('test', event)

    expect(received).toHaveLength(1)
    expect(received[0].type).toBe('message')
  })

  it('supports multiple subscribers on same topic', async () => {
    let count = 0
    adapter.subscribe('topic', () => count++)
    adapter.subscribe('topic', () => count++)

    await adapter.publish('topic', { type: 'typing', channel_id: 'ch-1', user_id: 'u1', active: true })
    expect(count).toBe(2)
  })

  it('unsubscribes correctly', async () => {
    let count = 0
    const unsub = adapter.subscribe('topic', () => count++)
    
    await adapter.publish('topic', { type: 'typing', channel_id: 'ch-1', user_id: 'u1', active: true })
    expect(count).toBe(1)

    unsub()
    await adapter.publish('topic', { type: 'typing', channel_id: 'ch-1', user_id: 'u1', active: true })
    expect(count).toBe(1) // No increment
  })

  it('tracks subscription count', () => {
    expect(adapter.subscriptionCount()).toBe(0)
    const unsub1 = adapter.subscribe('a', () => {})
    const unsub2 = adapter.subscribe('b', () => {})
    expect(adapter.subscriptionCount()).toBe(2)
    unsub1()
    expect(adapter.subscriptionCount()).toBe(1)
    unsub2()
    expect(adapter.subscriptionCount()).toBe(0)
  })

  it('isolates topics', async () => {
    let received = false
    adapter.subscribe('topic-a', () => { received = true })
    await adapter.publish('topic-b', { type: 'message', channel_id: 'ch', payload: {} })
    expect(received).toBe(false)
  })

  it('supports pattern subscriptions', async () => {
    const events: PubSubEvent[] = []
    adapter.psubscribe('channel:*', (e) => events.push(e))

    await adapter.publish('channel:ch-1', { type: 'message', channel_id: 'ch-1', payload: {} })
    await adapter.publish('channel:ch-2', { type: 'message', channel_id: 'ch-2', payload: {} })
    await adapter.publish('user:u-1', { type: 'presence', user_id: 'u-1', status: 'online', last_seen: Date.now() })

    expect(events).toHaveLength(2) // Only channel:* matched
  })

  it('close() clears all subscriptions', async () => {
    adapter.subscribe('a', () => {})
    adapter.subscribe('b', () => {})
    expect(adapter.subscriptionCount()).toBe(2)

    await adapter.close()
    expect(adapter.subscriptionCount()).toBe(0)
  })
})

// ── Redis Adapter (unit-level, no real Redis) ────────────────────────

describe('PubSub — RedisPubSub (unit)', () => {
  it('reports redis backend', () => {
    const adapter = new RedisPubSub({ url: 'redis://localhost:6379' })
    expect(adapter.backend).toBe('redis')
    expect(adapter.isConnected()).toBe(false)
  })

  it('throws on publish without connection', async () => {
    const adapter = new RedisPubSub({ url: 'redis://localhost:6379' })
    await expect(
      adapter.publish('test', { type: 'message', channel_id: 'ch', payload: {} })
    ).rejects.toThrow('redis_not_connected')
  })

  it('starts with 0 subscriptions', () => {
    const adapter = new RedisPubSub({ url: 'redis://localhost:6379' })
    expect(adapter.subscriptionCount()).toBe(0)
  })
})

// ── Factory ──────────────────────────────────────────────────────────

describe('PubSub — Factory', () => {
  afterEach(() => {
    resetPubSub()
  })

  it('returns MemoryPubSub when REDIS_URL is not set', () => {
    const adapter = getPubSub()
    expect(adapter.backend).toBe('memory')
  })

  it('returns same instance on repeated calls', () => {
    const a = getPubSub()
    const b = getPubSub()
    expect(a).toBe(b)
  })

  it('resetPubSub creates fresh instance', () => {
    const a = getPubSub()
    resetPubSub()
    const b = getPubSub()
    expect(a).not.toBe(b)
  })
})

// ── Event Types ──────────────────────────────────────────────────────

describe('PubSub — Event Types', () => {
  let adapter: MemoryPubSub

  beforeEach(() => {
    adapter = new MemoryPubSub()
  })

  afterEach(async () => {
    await adapter.close()
  })

  it('handles typing events', async () => {
    const events: PubSubEvent[] = []
    adapter.subscribe('channel:ch-1', (e) => events.push(e))

    await adapter.publish('channel:ch-1', {
      type: 'typing',
      channel_id: 'ch-1',
      user_id: 'u-1',
      active: true,
    })

    expect(events[0].type).toBe('typing')
  })

  it('handles presence events', async () => {
    const events: PubSubEvent[] = []
    adapter.subscribe('global:presence', (e) => events.push(e))

    await adapter.publish('global:presence', {
      type: 'presence',
      user_id: 'u-1',
      status: 'away',
      last_seen: Date.now(),
    })

    expect(events[0].type).toBe('presence')
  })

  it('handles reaction events', async () => {
    const events: PubSubEvent[] = []
    adapter.subscribe('channel:ch-1', (e) => events.push(e))

    await adapter.publish('channel:ch-1', {
      type: 'reaction',
      channel_id: 'ch-1',
      message_id: 'msg-1',
      emoji: '👍',
      user_id: 'u-1',
      action: 'add',
    })

    expect(events[0].type).toBe('reaction')
  })

  it('handles deletion events', async () => {
    const events: PubSubEvent[] = []
    adapter.subscribe('channel:ch-1', (e) => events.push(e))

    await adapter.publish('channel:ch-1', {
      type: 'deletion',
      channel_id: 'ch-1',
      message_id: 'msg-1',
      deleted_at: Date.now(),
    })

    expect(events[0].type).toBe('deletion')
  })
})
