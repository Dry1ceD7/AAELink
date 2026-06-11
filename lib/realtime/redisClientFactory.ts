/**
 * `lib/redisClientFactory.ts` — production adapter that wraps an `ioredis`
 * client into the `RedisLikeClient` interface that `RedisPubSub` consumes.
 *
 * `ioredis` is loaded **lazily** via dynamic `import()` so the package can be
 * absent during unit tests, in dev when `REDIS_URL` is not set, and on
 * `npm install --omit=optional` builds. Production deployments that need
 * multi-node fan-out should add `ioredis` to `dependencies` in their root
 * package.json (or accept `--include=optional`).
 */

import type { RedisLikeClient } from '@/lib/realtime/redisPubSub'

/**
 * The slice of the `ioredis` client surface that this adapter touches. Defined
 * structurally so the wrapper does not have to import `ioredis` types at type
 * check time.
 */
export interface IoredisLikeClient {
  publish(channel: string, message: string): Promise<number>
  subscribe(...channels: string[]): Promise<number>
  unsubscribe(...channels: string[]): Promise<number>
  psubscribe(...patterns: string[]): Promise<number>
  punsubscribe(...patterns: string[]): Promise<number>
  on(event: 'message' | 'pmessage', listener: (...args: unknown[]) => void): unknown
  quit(): Promise<unknown>
}

/**
 * Wrap an `ioredis`-shaped client (any client matching `IoredisLikeClient`)
 * into the simpler `RedisLikeClient` shape used by `RedisPubSub`.
 *
 * The `subscribe`/`unsubscribe`/`psubscribe`/`punsubscribe` methods on the
 * `RedisLikeClient` are fire-and-forget (return `void`) because `RedisPubSub`
 * does not currently inspect their result; we forward to `ioredis`'s
 * promise-returning forms and let the promise resolve in the background.
 */
export function wrapIoredis(client: IoredisLikeClient): RedisLikeClient {
  let messageHandler: ((channel: string, message: string) => void) | null = null

  // Wire up the message bus once. ioredis emits 'message' for plain subscribe
  // and 'pmessage' for pattern subscribe (with one extra `pattern` arg first).
  client.on('message', (...args: unknown[]) => {
    const [channel, message] = args as [string, string]
    if (messageHandler) messageHandler(channel, message)
  })
  client.on('pmessage', (...args: unknown[]) => {
    // ioredis pmessage signature: (pattern, channel, message)
    const [, channel, message] = args as [string, string, string]
    if (messageHandler) messageHandler(channel, message)
  })

  return {
    publish(channel, message) {
      return client.publish(channel, message)
    },
    subscribe(channel) {
      void client.subscribe(channel)
    },
    unsubscribe(channel) {
      void client.unsubscribe(channel)
    },
    psubscribe(pattern) {
      void client.psubscribe(pattern)
    },
    punsubscribe(pattern) {
      void client.punsubscribe(pattern)
    },
    onMessage(handler) {
      messageHandler = handler
    },
    async quit() {
      await client.quit()
    },
  }
}

/**
 * Default factory: lazily imports `ioredis` and returns a `RedisLikeClient`.
 *
 * Throws `redis_client_unavailable` when `ioredis` is not installed, so the
 * caller can fall back to `MemoryPubSub` cleanly.
 */
export async function defaultRedisClientFactory(url: string): Promise<RedisLikeClient> {
  let mod: { default: new (url: string) => IoredisLikeClient }
  try {
    // Dynamic import so unit tests + dev runs without `ioredis` installed
    // don't have to satisfy a static dependency. The package is intentionally
    // optional; production deployments add it to their root `dependencies`.
    // @ts-expect-error — `ioredis` is a runtime-optional dependency
    mod = (await import(/* webpackIgnore: true */ 'ioredis')) as typeof mod
  } catch {
    throw new Error('redis_client_unavailable')
  }
  const Ctor = mod.default
  const client = new Ctor(url)
  return wrapIoredis(client)
}


// ── Redis Streams adapter for the replay store ─────────────────────

import type { StreamCommands } from '@/lib/realtime/wsGateway/redisStreamsReplay'

/**
 * The `ioredis` shape we consume for stream operations. Defined structurally
 * so this adapter does not require an `ioredis` type import.
 */
export interface IoredisStreamClient {
  xadd(...args: string[]): Promise<string>
  xrange(key: string, start: string, end: string, ...rest: string[]): Promise<Array<[string, string[]]>>
}

/**
 * Wrap an `ioredis` client as a `StreamCommands` for the
 * `RedisStreamsReplayStore`. Encapsulates the `XADD MAXLEN ~ N * field value`
 * argument layout so the store stays clean.
 */
export function wrapIoredisStream(client: IoredisStreamClient): StreamCommands {
  return {
    async xadd(key, maxlenApprox, field, value) {
      // XADD <key> MAXLEN ~ <maxlen> * <field> <value>
      return await client.xadd(
        key,
        'MAXLEN',
        '~',
        String(maxlenApprox),
        '*',
        field,
        value
      )
    },
    async xrange(key, start, end) {
      return await client.xrange(key, start, end)
    },
  }
}
