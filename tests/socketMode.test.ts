/**
 * `lib/apps/socketMode.ts` — socket-mode ticket lifecycle + event routing.
 *
 * Integrations parity §25 (matrix line 360/362): the WS gateway must validate a
 * socket-mode ticket on connect and stream an app's events to the socket, then
 * release the ticket on disconnect. These were previously caller-less.
 *
 * Two surfaces are covered:
 *   1. Ticket lifecycle (resolveSocketTicket / closeSocketConnection) against a
 *      fake in-memory pool that models the `socket_connections` table for the
 *      exact SQL these functions issue. No live DB → deterministic, but the
 *      assertions exercise the REAL status/expiry branches: remove the expiry or
 *      status guard in socketMode.ts and these tests fail.
 *   2. Event routing (createSocketModeConnection) against a real MemoryPubSub +
 *      a capturing fake socket — an app-targeted event reaches the right
 *      connection and NOT a connection bound to a different app.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { Pool } from 'pg'
import { MemoryPubSub } from '@/lib/realtime/redisPubSub'
import {
  resolveSocketTicket,
  closeSocketConnection,
  openSocketConnection,
  createSocketModeConnection,
  appEventTopic,
  publishAppEvent,
  SOCKET_TICKET_TTL_MS,
} from '@/lib/apps/socketMode'

// ── Fake pool modeling the rows socketMode.ts reads/writes ───────────
interface SockRow {
  id: string
  bot_id: string
  ticket: string
  status: string
  expires_at: number
  created_at: number
}
interface BotRow {
  id: string
  api_token: string
  status: string
}

function makeFakePool(opts: { bots?: BotRow[]; conns?: SockRow[] } = {}): {
  pool: Pool
  conns: SockRow[]
} {
  const bots = opts.bots ?? []
  const conns = opts.conns ?? []
  const query = async (sql: string, params: unknown[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim()
    if (s.startsWith('SELECT id, status FROM aaelink.bot_users')) {
      const row = bots.find((b) => b.api_token === params[0])
      return { rows: row ? [{ id: row.id, status: row.status }] : [] }
    }
    if (s.startsWith('INSERT INTO aaelink.socket_connections')) {
      conns.push({
        id: params[0] as string,
        bot_id: params[1] as string,
        ticket: params[2] as string,
        status: 'open',
        expires_at: params[3] as number,
        created_at: params[4] as number,
      })
      return { rows: [], rowCount: 1 }
    }
    if (s.startsWith('SELECT id, bot_id, status')) {
      const row = conns.find((c) => c.ticket === params[0])
      return {
        rows: row
          ? [{ id: row.id, bot_id: row.bot_id, status: row.status, expires_at: String(row.expires_at) }]
          : [],
      }
    }
    if (s.startsWith("UPDATE aaelink.socket_connections SET status = 'closed'")) {
      const row = conns.find((c) => c.ticket === params[0] && c.status === 'open')
      if (row) row.status = 'closed'
      return { rows: [], rowCount: row ? 1 : 0 }
    }
    throw new Error(`unexpected SQL: ${s}`)
  }
  return { pool: { query } as unknown as Pool, conns }
}

// ── Capturing socket (mirrors wsGateway router test) ─────────────────
class CapturingSocket {
  sent: string[] = []
  closedCode?: number
  send(message: string): void {
    this.sent.push(message)
  }
  close(code?: number): void {
    this.closedCode = code ?? 1000
  }
}

describe('socketMode — ticket lifecycle', () => {
  const now = 1_000_000

  it('resolveSocketTicket accepts a freshly opened ticket', async () => {
    const { pool } = makeFakePool({ bots: [{ id: 'bot-1', api_token: 'xoxb-a', status: 'active' }] })
    const opened = await openSocketConnection(pool, 'xoxb-a', 'wss://gw', now)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const resolved = await resolveSocketTicket(pool, opened.ticket, now + 1)
    expect(resolved).toEqual({ ok: true, botId: 'bot-1', connectionId: expect.any(String) })
  })

  it('rejects an unknown ticket', async () => {
    const { pool } = makeFakePool()
    expect(await resolveSocketTicket(pool, 'sock_nope', now)).toEqual({
      ok: false,
      code: 'invalid_ticket',
    })
  })

  it('rejects an expired ticket', async () => {
    const { pool } = makeFakePool({ bots: [{ id: 'bot-1', api_token: 'xoxb-a', status: 'active' }] })
    const opened = await openSocketConnection(pool, 'xoxb-a', 'wss://gw', now)
    if (!opened.ok) throw new Error('open failed')
    // Advance past TTL.
    const resolved = await resolveSocketTicket(pool, opened.ticket, now + SOCKET_TICKET_TTL_MS + 1)
    expect(resolved).toEqual({ ok: false, code: 'ticket_expired' })
  })

  it('rejects an already-closed ticket', async () => {
    const { pool } = makeFakePool({ bots: [{ id: 'bot-1', api_token: 'xoxb-a', status: 'active' }] })
    const opened = await openSocketConnection(pool, 'xoxb-a', 'wss://gw', now)
    if (!opened.ok) throw new Error('open failed')

    const released = await closeSocketConnection(pool, opened.ticket)
    expect(released).toBe(true)

    const resolved = await resolveSocketTicket(pool, opened.ticket, now + 1)
    expect(resolved).toEqual({ ok: false, code: 'closed' })
  })

  it('closeSocketConnection releases an open ticket exactly once', async () => {
    const { pool } = makeFakePool({ bots: [{ id: 'bot-1', api_token: 'xoxb-a', status: 'active' }] })
    const opened = await openSocketConnection(pool, 'xoxb-a', 'wss://gw', now)
    if (!opened.ok) throw new Error('open failed')

    expect(await closeSocketConnection(pool, opened.ticket)).toBe(true)
    // Second close is a no-op (already closed).
    expect(await closeSocketConnection(pool, opened.ticket)).toBe(false)
  })
})

describe('socketMode — event routing (createSocketModeConnection)', () => {
  let pubsub: MemoryPubSub

  beforeEach(() => {
    pubsub = new MemoryPubSub()
  })

  it('forwards an app-targeted event to the right connection and not others', async () => {
    const sockA = new CapturingSocket()
    const sockB = new CapturingSocket()
    const connA = createSocketModeConnection({ pubsub, socket: sockA, botId: 'bot-a', connectionId: 'c-a' })
    const connB = createSocketModeConnection({ pubsub, socket: sockB, botId: 'bot-b', connectionId: 'c-b' })
    // Drop the hello frames.
    sockA.sent.length = 0
    sockB.sent.length = 0

    await publishAppEvent(pubsub, 'bot-a', {
      type: 'message',
      channel_id: 'ch-1',
      payload: { id: 'm1' },
    })

    const aEvents = sockA.sent.map((s) => JSON.parse(s)).filter((f) => f.type === 'event')
    const bEvents = sockB.sent.map((s) => JSON.parse(s)).filter((f) => f.type === 'event')

    expect(aEvents).toHaveLength(1)
    expect(aEvents[0].topic).toBe(appEventTopic('bot-a'))
    expect(aEvents[0].payload).toMatchObject({ type: 'message', channel_id: 'ch-1' })
    // bot-b's socket must NOT see bot-a's event.
    expect(bEvents).toHaveLength(0)

    connA.close()
    connB.close()
  })

  it('sends a hello frame on bind and stops forwarding after close', async () => {
    const sock = new CapturingSocket()
    const conn = createSocketModeConnection({ pubsub, socket: sock, botId: 'bot-a', connectionId: 'c-a' })

    const hello = sock.sent.map((s) => JSON.parse(s)).find((f) => f.type === 'hello')
    expect(hello).toMatchObject({ type: 'hello', bot_id: 'bot-a', connection_id: 'c-a' })

    conn.close()
    sock.sent.length = 0
    await publishAppEvent(pubsub, 'bot-a', { type: 'message', channel_id: 'ch-1', payload: {} })
    expect(sock.sent).toHaveLength(0)
  })
})
