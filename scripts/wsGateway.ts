#!/usr/bin/env node
/**
 * `scripts/wsGateway.ts` — standalone WebSocket gateway service.
 *
 * Run alongside the Next.js app pods. Each WS gateway process subscribes to
 * the same Redis pub/sub bus the Next.js app publishes to (via
 * `lib/redisPubSub.ts`); both reads (`pubsub.subscribe`) and writes
 * (`pubsub.publish`) flow through the same broker so multi-node fan-out
 * works.
 *
 * Boot:
 *   npm run ws:gateway
 *
 * Required env vars:
 *   - `WS_GATEWAY_PORT` (default 3041)
 *   - `REDIS_URL` (recommended for multi-node; falls back to memory adapter)
 *   - `AAELINK_SESSION_SECRET` (must match the Next.js app secret)
 *
 * The session cookie is validated **once at upgrade time**. Long-lived
 * connections do not re-validate; expiring tokens take effect on the next
 * reconnect.
 */

import { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { createServer } from 'node:http'
import { parse as parseUrl } from 'node:url'
import { getPubSubAsync } from '@/lib/realtime/redisPubSub'
import { createConnection, type OutboundSocket } from '@/lib/realtime/wsGateway/router'
import { MemoryReplayStore, type ReplayStore } from '@/lib/realtime/wsGateway/replay'
import { RedisStreamsReplayStore } from '@/lib/realtime/wsGateway/redisStreamsReplay'
import { wrapIoredisStream } from '@/lib/realtime/redisClientFactory'
import { readSessionUserIdFromCookieHeader } from '@/lib/auth/session'

interface WsLikeServer {
  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    cb: (ws: WsLikeWebSocket) => void
  ): void
}

interface WsLikeWebSocket {
  send(data: string): void
  close(code?: number, reason?: string): void
  on(event: 'message', listener: (data: Buffer | string) => void): unknown
  on(event: 'close', listener: () => void): unknown
  on(event: 'error', listener: (err: Error) => void): unknown
}

async function main(): Promise<void> {
  const port = Number(process.env.WS_GATEWAY_PORT || 3041)

  // Load `ws` lazily so the package stays an opt-in production dependency.
  let WebSocketServer: new (opts: { noServer: true }) => WsLikeServer
  try {
    const wsModule = (await import('ws')) as unknown as {
      WebSocketServer: typeof WebSocketServer
    }
    WebSocketServer = wsModule.WebSocketServer
  } catch {
    console.error(
      '[wsGateway] `ws` package is not installed. Add it to dependencies before running this script.'
    )
    process.exit(1)
  }

  const pubsub = await getPubSubAsync()
  console.log(`[wsGateway] Pub/sub backend: ${pubsub.backend}`)

  // Replay store: prefer Redis Streams for shared retention across pods
  // when `REDIS_URL` is set; fall back to per-pod memory ring when not.
  const maxPerTopic = Number(process.env.WS_REPLAY_MAX_PER_TOPIC || 1000)
  let replay: ReplayStore = new MemoryReplayStore({ maxPerTopic })
  if (process.env.REDIS_URL) {
    try {
      // Lazy ioredis import — same pattern as `lib/redisClientFactory.ts`.
      // @ts-expect-error — `ioredis` is a runtime-optional dependency
      const ioredisModule = (await import('ioredis')) as unknown as {
        default: new (url: string) => Parameters<typeof wrapIoredisStream>[0]
      }
      const streamClient = new ioredisModule.default(process.env.REDIS_URL)
      replay = new RedisStreamsReplayStore({
        stream: wrapIoredisStream(streamClient),
        prefix: process.env.WS_REPLAY_PREFIX || 'aae:replay:',
        maxPerTopic,
      })
      console.log('[wsGateway] Replay store: redis_streams')
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown'
      console.warn(`[wsGateway] Falling back to MemoryReplayStore: ${reason}`)
    }
  }
  if (replay instanceof MemoryReplayStore) {
    console.log('[wsGateway] Replay store: memory')
  }
  pubsub.psubscribe('*', (event) => {
    const topic = event.type === 'message' || event.type === 'typing'
      ? `channel:${event.channel_id}`
      : event.type === 'presence'
        ? `presence:${event.user_id}`
        : ''
    if (topic) void replay.record(topic, event)
  })

  const wss = new WebSocketServer({ noServer: true })
  const httpServer = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', backend: pubsub.backend }))
  })

  httpServer.on('upgrade', (req, socket, head) => {
    void (async () => {
      const url = parseUrl(req.url || '', true)
      if (url.pathname !== '/ws') {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
        socket.destroy()
        return
      }

      const cookieHeader = req.headers.cookie || ''
      const userId = await readSessionUserIdFromCookieHeader(cookieHeader)
      if (!userId) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }

      wss.handleUpgrade(req, socket, head, (ws: WsLikeWebSocket) => {
        const out: OutboundSocket = {
          send: (msg) => ws.send(msg),
          close: () => ws.close(),
        }
        const conn = createConnection({
          pubsub,
          socket: out,
          userId,
          replay,
          security: {
            // Use the router's default topic allowlist (channel:*, user:*,
            // workspace:*, global:presence). Per-connection rate limit and
            // subscription cap are env-tunable; the defaults below are
            // generous enough for normal traffic and tight enough to bound
            // a misbehaving client.
            maxFramesPerWindow: Number(process.env.WS_MAX_FRAMES_PER_WINDOW || 100),
            frameWindowMs: Number(process.env.WS_FRAME_WINDOW_MS || 1_000),
            maxSubscriptions: Number(process.env.WS_MAX_SUBSCRIPTIONS || 200),
          },
        })
        ws.on('message', (data) => {
          const raw = typeof data === 'string' ? data : data.toString('utf8')
          conn.handleMessage(raw)
        })
        ws.on('close', () => conn.close())
        ws.on('error', () => conn.close())
      })
    })().catch((err) => {
      console.error('[wsGateway] upgrade error:', err)
      socket.destroy()
    })
  })

  httpServer.listen(port, () => {
    console.log(`[wsGateway] listening on :${port} (path /ws)`)
  })
}

main().catch((err) => {
  console.error('[wsGateway] fatal:', err)
  process.exit(1)
})
