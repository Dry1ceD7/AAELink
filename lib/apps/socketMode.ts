/**
 * D7 Developer platform — socket mode.
 *
 * An app opens a socket-mode connection by authenticating with its bot token;
 * it receives a short-lived ticket and a WSS URL to connect to. The realtime
 * gateway validates the ticket on connect (resolveSocketTicket) and thereafter
 * streams events over that socket — an alternative to a public request URL.
 *
 * Tickets are single-purpose and short-lived (default 3 minutes), so a leaked
 * URL is useless once it expires or the connection closes.
 */
import type { Pool } from 'pg'
import { randomUUID } from 'crypto'
import type { PubSubAdapter, PubSubEvent } from '@/lib/realtime/redisPubSub'

/** Ticket lifetime — short, like Slack's socket-mode WSS URLs. */
export const SOCKET_TICKET_TTL_MS = 180_000

export type OpenConnectionResult =
  | { ok: true; ticket: string; url: string; expires_at: number; bot_id: string }
  | { ok: false; code: 'invalid_app_token' | 'bot_inactive' }

/**
 * Open a socket-mode connection for the app identified by its bot token. Issues
 * a ticket + WSS URL. `wssBase` is the gateway origin (e.g. wss://host); the
 * ticket is carried as a query param the gateway checks on connect.
 */
export async function openSocketConnection(
  pool: Pool,
  botToken: string,
  wssBase: string,
  now = Date.now()
): Promise<OpenConnectionResult> {
  const token = String(botToken || '').trim()
  if (!token) return { ok: false, code: 'invalid_app_token' }

  const { rows } = await pool.query<{ id: string; status: string }>(
    `SELECT id, status FROM aaelink.bot_users WHERE api_token = $1`,
    [token]
  )
  const bot = rows[0]
  if (!bot) return { ok: false, code: 'invalid_app_token' }
  if (bot.status !== 'active') return { ok: false, code: 'bot_inactive' }

  const id = randomUUID()
  const ticket = `sock_${randomUUID().replace(/-/g, '')}`
  const expiresAt = now + SOCKET_TICKET_TTL_MS
  await pool.query(
    `INSERT INTO aaelink.socket_connections (id, bot_id, ticket, status, expires_at, created_at)
     VALUES ($1, $2, $3, 'open', $4, $5)`,
    [id, bot.id, ticket, expiresAt, now]
  )

  const base = wssBase.replace(/\/+$/, '')
  return { ok: true, ticket, url: `${base}/apps/socket?ticket=${ticket}`, expires_at: expiresAt, bot_id: bot.id }
}

export type ResolveTicketResult =
  | { ok: true; botId: string; connectionId: string }
  | { ok: false; code: 'invalid_ticket' | 'ticket_expired' | 'closed' }

/** Validate a socket ticket on connect (gateway-side). Does not consume it. */
export async function resolveSocketTicket(pool: Pool, ticket: string, now = Date.now()): Promise<ResolveTicketResult> {
  const { rows } = await pool.query<{ id: string; bot_id: string; status: string; expires_at: string }>(
    `SELECT id, bot_id, status, expires_at::text AS expires_at FROM aaelink.socket_connections WHERE ticket = $1`,
    [String(ticket || '').trim()]
  )
  const row = rows[0]
  if (!row) return { ok: false, code: 'invalid_ticket' }
  if (row.status !== 'open') return { ok: false, code: 'closed' }
  if (Number(row.expires_at) <= now) return { ok: false, code: 'ticket_expired' }
  return { ok: true, botId: row.bot_id, connectionId: row.id }
}

/** Close a socket connection by ticket (on disconnect or revoke). */
export async function closeSocketConnection(pool: Pool, ticket: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE aaelink.socket_connections SET status = 'closed' WHERE ticket = $1 AND status = 'open'`,
    [String(ticket || '').trim()]
  )
  return (rowCount ?? 0) > 0
}

// ── Socket-mode event streaming ──────────────────────────────────────
//
// Socket mode is an alternative to a public request URL: instead of POSTing
// event_deliver jobs to an external endpoint (see lib/webhooks/webhookEmitter.ts
// fanOutEventSubscriptions), an app holds a live WS connection and events are
// streamed to it over the realtime bus. Each app/bot owns one pub/sub topic;
// the gateway subscribes a validated socket to that topic and forwards events.
//
// Topic naming mirrors the channel:/user:/workspace: convention in
// lib/realtime/redisPubSub.ts — `app:<botId>` is the per-app event stream.

/** Pub/sub topic carrying an app/bot's socket-mode event stream. */
export function appEventTopic(botId: string): string {
  return `app:${String(botId || '').trim()}`
}

/**
 * Publish an event onto an app/bot's socket-mode stream. Callers that already
 * fan an event out to event_subscriptions (HTTP) can additionally call this so
 * apps connected via socket mode receive the same envelope over the realtime
 * bus. Best-effort: realtime delivery must never block the request path.
 */
export async function publishAppEvent(
  pubsub: Pick<PubSubAdapter, 'publish'>,
  botId: string,
  event: PubSubEvent
): Promise<void> {
  await pubsub.publish(appEventTopic(botId), event)
}

/** Minimal outbound transport the gateway injects (mirrors wsGateway router). */
export interface SocketModeOutbound {
  send(message: string): void
  close(code?: number, reason?: string): void
}

export interface SocketModeConnection {
  /** Tear down the pub/sub subscription. Idempotent. */
  close(): void
}

/**
 * Bind a validated socket-mode socket to an app/bot's event stream.
 *
 * Subscribes to `app:<botId>` and forwards every event published there to the
 * socket as a JSON envelope. Because the subscription is keyed by the bot's own
 * topic, events for a DIFFERENT app (a different `app:<otherBot>` topic) are
 * never delivered here — isolation is by topic, so one app cannot observe
 * another app's events. Returns a handle whose `close()` releases the
 * subscription (call it on disconnect, alongside closeSocketConnection).
 *
 * Pure + transport-agnostic so it is unit-testable with MemoryPubSub and a
 * capturing fake socket — no live `ws` server required.
 */
export function createSocketModeConnection(opts: {
  pubsub: Pick<PubSubAdapter, 'subscribe'>
  socket: SocketModeOutbound
  botId: string
  connectionId: string
}): SocketModeConnection {
  const { pubsub, socket, botId, connectionId } = opts
  const topic = appEventTopic(botId)
  let closed = false

  // Acknowledge a successful handshake so the client knows streaming has begun.
  socket.send(JSON.stringify({ type: 'hello', bot_id: botId, connection_id: connectionId }))

  const unsubscribe = pubsub.subscribe(topic, (event: PubSubEvent) => {
    if (closed) return
    socket.send(JSON.stringify({ type: 'event', topic, payload: event }))
  })

  return {
    close(): void {
      if (closed) return
      closed = true
      unsubscribe()
    },
  }
}
