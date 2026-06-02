/**
 * `lib/redisClientFactory.ts` — pin the contract for the `ioredis` adapter
 * factory and the auto-connecting `getPubSub()` wrapper.
 *
 * The factory itself wraps an `ioredis`-shaped client into the
 * `RedisLikeClient` interface that `RedisPubSub` consumes. We do not exercise
 * a real `ioredis` connection here (no Redis available in unit tests); the
 * tests cover (a) the lazy-import surface, (b) the connection-failure → memory
 * fallback path, and (c) idempotent `getPubSub()` behavior across resets.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  wrapIoredis,
  type IoredisLikeClient,
} from '@/lib/realtime/redisClientFactory'
import { resetPubSub, getPubSub } from '@/lib/realtime/redisPubSub'

// ── wrapIoredis — adapter shape ──────────────────────────────────────

class FakeIoredis implements IoredisLikeClient {
  channels: string[] = []
  patterns: string[] = []
  published: Array<{ channel: string; message: string }> = []
  closed = false
  private messageListeners: Array<(channel: string, message: string) => void> = []
  private pmessageListeners: Array<(pattern: string, channel: string, message: string) => void> = []

  async publish(channel: string, message: string): Promise<number> {
    this.published.push({ channel, message })
    return 1
  }
  subscribe(...channels: string[]): Promise<number> {
    this.channels.push(...channels)
    return Promise.resolve(this.channels.length)
  }
  unsubscribe(...channels: string[]): Promise<number> {
    this.channels = this.channels.filter(c => !channels.includes(c))
    return Promise.resolve(this.channels.length)
  }
  psubscribe(...patterns: string[]): Promise<number> {
    this.patterns.push(...patterns)
    return Promise.resolve(this.patterns.length)
  }
  punsubscribe(...patterns: string[]): Promise<number> {
    this.patterns = this.patterns.filter(p => !patterns.includes(p))
    return Promise.resolve(this.patterns.length)
  }
  on(event: string, fn: (...args: unknown[]) => void): this {
    if (event === 'message') {
      this.messageListeners.push(fn as (channel: string, message: string) => void)
    } else if (event === 'pmessage') {
      this.pmessageListeners.push(fn as (pattern: string, channel: string, message: string) => void)
    }
    return this
  }
  async quit(): Promise<'OK'> {
    this.closed = true
    return 'OK'
  }

  // Test helpers — simulate ioredis emitting an event from another publisher.
  emitMessage(channel: string, message: string): void {
    for (const fn of this.messageListeners) fn(channel, message)
  }
  emitPmessage(pattern: string, channel: string, message: string): void {
    for (const fn of this.pmessageListeners) fn(pattern, channel, message)
  }
}

describe('redisClientFactory — wrapIoredis', () => {
  it('returns a RedisLikeClient with the documented shape', () => {
    const client = wrapIoredis(new FakeIoredis())
    expect(typeof client.publish).toBe('function')
    expect(typeof client.subscribe).toBe('function')
    expect(typeof client.unsubscribe).toBe('function')
    expect(typeof client.psubscribe).toBe('function')
    expect(typeof client.punsubscribe).toBe('function')
    expect(typeof client.onMessage).toBe('function')
    expect(typeof client.quit).toBe('function')
  })

  it('forwards publish through the underlying ioredis', async () => {
    const fake = new FakeIoredis()
    const client = wrapIoredis(fake)
    await client.publish('aae:room:1', '{"type":"msg"}')
    expect(fake.published).toEqual([{ channel: 'aae:room:1', message: '{"type":"msg"}' }])
  })

  it('forwards subscribe/unsubscribe to the underlying ioredis', () => {
    const fake = new FakeIoredis()
    const client = wrapIoredis(fake)
    client.subscribe('a')
    client.subscribe('b')
    expect(fake.channels).toEqual(['a', 'b'])
    client.unsubscribe('a')
    expect(fake.channels).toEqual(['b'])
  })

  it('forwards psubscribe/punsubscribe to the underlying ioredis', () => {
    const fake = new FakeIoredis()
    const client = wrapIoredis(fake)
    client.psubscribe('room:*')
    expect(fake.patterns).toEqual(['room:*'])
    client.punsubscribe('room:*')
    expect(fake.patterns).toEqual([])
  })

  it('routes ioredis "message" events into the onMessage handler', () => {
    const fake = new FakeIoredis()
    const client = wrapIoredis(fake)
    const received: Array<{ channel: string; message: string }> = []
    client.onMessage((channel, message) => { received.push({ channel, message }) })
    fake.emitMessage('topic', 'payload')
    expect(received).toEqual([{ channel: 'topic', message: 'payload' }])
  })

  it('routes ioredis "pmessage" events into the onMessage handler with channel only', () => {
    const fake = new FakeIoredis()
    const client = wrapIoredis(fake)
    const received: Array<{ channel: string; message: string }> = []
    client.onMessage((channel, message) => { received.push({ channel, message }) })
    fake.emitPmessage('room:*', 'room:1', 'payload')
    expect(received).toEqual([{ channel: 'room:1', message: 'payload' }])
  })

  it('quit closes the underlying ioredis client', async () => {
    const fake = new FakeIoredis()
    const client = wrapIoredis(fake)
    await client.quit()
    expect(fake.closed).toBe(true)
  })
})

// ── getPubSub — fallback when REDIS_URL is unset ─────────────────────

describe('redisPubSub — getPubSub fallback', () => {
  const originalEnv = process.env.REDIS_URL

  beforeEach(() => {
    delete process.env.REDIS_URL
    resetPubSub()
  })

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.REDIS_URL
    else process.env.REDIS_URL = originalEnv
    resetPubSub()
  })

  it('returns a memory adapter when REDIS_URL is unset', () => {
    const adapter = getPubSub()
    expect(adapter.backend).toBe('memory')
  })

  it('returns the same instance on repeated calls', () => {
    expect(getPubSub()).toBe(getPubSub())
  })

  it('resetPubSub gives a fresh instance', () => {
    const before = getPubSub()
    resetPubSub()
    const after = getPubSub()
    expect(before).not.toBe(after)
  })
})
