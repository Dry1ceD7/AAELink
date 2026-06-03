/**
 * Integration tests for D7 socket mode.
 *
 * Exercises lib/apps/socketMode.ts against a live Postgres. The route
 * (app/api/apps/connections/open) is a thin bearer-token wrapper.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, TestContext } from '../helpers'
import {
  openSocketConnection,
  resolveSocketTicket,
  closeSocketConnection,
  SOCKET_TICKET_TTL_MS,
} from '@/lib/apps/socketMode'

let ctx: TestContext
const botIds: string[] = []
const WSS = 'wss://gw.test'

async function mkBot(status = 'active'): Promise<string> {
  const id = randomUUID()
  const apiToken = `xoxb-${randomUUID().replace(/-/g, '')}`
  await ctx.pool.query(
    `INSERT INTO aaelink.bot_users (id, kind, name, scopes, status, api_token, created_at)
     VALUES ($1, 'bot', $2, '[]', $3, $4, $5)`,
    [id, `bot-${id.slice(0, 6)}`, status, apiToken, Date.now()]
  )
  botIds.push(id)
  return apiToken
}

beforeAll(async () => { ctx = await createTestContext() })

afterAll(async () => {
  if (botIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.socket_connections WHERE bot_id = ANY($1)`, [botIds])
    await ctx.pool.query(`DELETE FROM aaelink.bot_users WHERE id = ANY($1)`, [botIds])
  }
})

describe('openSocketConnection', () => {
  it('rejects an unknown or empty token', async () => {
    expect(await openSocketConnection(ctx.pool, '', WSS)).toEqual({ ok: false, code: 'invalid_app_token' })
    expect(await openSocketConnection(ctx.pool, 'xoxb-nope', WSS)).toEqual({ ok: false, code: 'invalid_app_token' })
  })

  it('rejects an inactive bot', async () => {
    const token = await mkBot('disabled')
    expect(await openSocketConnection(ctx.pool, token, WSS)).toEqual({ ok: false, code: 'bot_inactive' })
  })

  it('issues a ticket + WSS URL for an active bot', async () => {
    const token = await mkBot('active')
    const now = 1_700_000_000_000
    const res = await openSocketConnection(ctx.pool, token, WSS, now)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.url).toBe(`${WSS}/apps/socket?ticket=${res.ticket}`)
      expect(res.expires_at).toBe(now + SOCKET_TICKET_TTL_MS)
    }
  })
})

describe('resolveSocketTicket', () => {
  it('validates a fresh ticket, rejects unknown/expired/closed', async () => {
    const token = await mkBot('active')
    const now = 1_700_000_000_000
    const opened = await openSocketConnection(ctx.pool, token, WSS, now)
    if (!opened.ok) throw new Error('open failed')

    expect(await resolveSocketTicket(ctx.pool, 'nope')).toEqual({ ok: false, code: 'invalid_ticket' })

    const fresh = await resolveSocketTicket(ctx.pool, opened.ticket, now + 1000)
    expect(fresh.ok).toBe(true)
    if (fresh.ok) expect(fresh.botId).toBe(opened.bot_id)

    const expired = await resolveSocketTicket(ctx.pool, opened.ticket, now + SOCKET_TICKET_TTL_MS + 1)
    expect(expired).toEqual({ ok: false, code: 'ticket_expired' })
  })

  it('reports a closed connection', async () => {
    const token = await mkBot('active')
    const opened = await openSocketConnection(ctx.pool, token, WSS)
    if (!opened.ok) throw new Error('open failed')

    expect(await closeSocketConnection(ctx.pool, opened.ticket)).toBe(true)
    expect(await closeSocketConnection(ctx.pool, opened.ticket)).toBe(false) // already closed
    expect(await resolveSocketTicket(ctx.pool, opened.ticket)).toEqual({ ok: false, code: 'closed' })
  })
})
