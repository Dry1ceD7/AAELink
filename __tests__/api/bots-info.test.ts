/**
 * Integration tests — GET /api/bots/info (Slack bots.info parity, matrix #16).
 *
 * The route must resolve bot identity from aaelink.bot_users — the canonical
 * model (#15) used by resolveBotToken — NOT from users WHERE platform_role='bot'.
 * These tests create a bot through the bot_users path (the model that was
 * previously invisible to bots.info) and assert it is returned.
 *
 * Coverage:
 *   1. Auth required (no session → 401).
 *   2. A bot created via bot_users is returned by ?bot_id= with mapped fields.
 *   3. The same bot appears in the list response.
 *   4. Unknown bot id → 404 bot_not_found.
 *   5. A legacy users WHERE platform_role='bot' row is NOT resolvable (proves
 *      the route reads bot_users, not users — i.e. the bridge actually moved).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser,
  asRequest, parseResponse,
  TestContext, TestUser,
} from '../helpers'

let ctx: TestContext
let admin: TestUser

const botIds: string[] = []
const userIds: string[] = []

/** Insert a bot_users row the same way app/api/integrations/bots does. */
async function mkBot(opts: { name: string; status?: string; avatar?: string }): Promise<{ id: string; clientId: string }> {
  const id = randomUUID()
  const clientId = `aae_bot_${randomUUID().replace(/-/g, '')}`
  await ctx.pool.query(
    `INSERT INTO aaelink.bot_users
       (id, kind, name, description, avatar_url, scopes, status, client_id, api_token, created_by, created_at)
     VALUES ($1, 'bot', $2, '', $3, '[]', $4, $5, $6, $7, $8)`,
    [
      id, opts.name, opts.avatar ?? '', opts.status ?? 'active', clientId,
      `xbot-${randomUUID().replace(/-/g, '')}`, admin.id, Date.now(),
    ]
  )
  botIds.push(id)
  return { id, clientId }
}

beforeAll(async () => {
  ctx = await createTestContext()
  admin = await createTestUser(ctx.pool, { role: 'platform_admin' })
  userIds.push(admin.id)
})

afterAll(async () => {
  if (botIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.bot_users WHERE id = ANY($1)`, [botIds])
  }
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('GET /api/bots/info', () => {
  it('no session → 401 unauthorized', async () => {
    const { GET } = await import('@/app/api/bots/info/route')
    const req = asRequest('GET', '/api/bots/info', { query: { bot_id: 'whatever' } })
    const res = await GET(req)
    expect(res.status).toBe(401)
    const body = await parseResponse(res)
    expect(body.error).toBe('unauthorized')
  })

  it('returns a bot created via the bot_users path (#15 model)', async () => {
    const { GET } = await import('@/app/api/bots/info/route')
    const { id, clientId } = await mkBot({ name: 'Botty McBotface', avatar: 'https://x/icon.png' })

    const req = asRequest('GET', '/api/bots/info', {
      cookie: admin.sessionCookie,
      query: { bot_id: id },
    })
    const res = await GET(req)
    expect(res.status, `Expected 200 but got ${res.status}: ${await res.clone().text()}`).toBe(200)
    const body = await parseResponse<{ ok: boolean; bot: Record<string, unknown> }>(res)
    expect(body.ok).toBe(true)
    expect(body.bot.id).toBe(id)
    expect(body.bot.name).toBe('Botty McBotface')
    expect(body.bot.deleted).toBe(false)
    expect(body.bot.app_id).toBe(clientId) // app linkage from bot_users.client_id
    expect((body.bot.icons as { image_48: string }).image_48).toBe('https://x/icon.png')
  })

  it('marks a non-active bot as deleted', async () => {
    const { GET } = await import('@/app/api/bots/info/route')
    const { id } = await mkBot({ name: 'Retired Bot', status: 'revoked' })

    const req = asRequest('GET', '/api/bots/info', {
      cookie: admin.sessionCookie,
      query: { bot_id: id },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await parseResponse<{ bot: { deleted: boolean } }>(res)
    expect(body.bot.deleted).toBe(true)
  })

  it('list response includes the bot_users bot', async () => {
    const { GET } = await import('@/app/api/bots/info/route')
    const { id } = await mkBot({ name: 'Listed Bot' })

    const req = asRequest('GET', '/api/bots/info', { cookie: admin.sessionCookie })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await parseResponse<{ ok: boolean; bots: Array<{ id: string }> }>(res)
    expect(body.ok).toBe(true)
    expect(body.bots.map(b => b.id)).toContain(id)
  })

  it('unknown bot id → 404 bot_not_found', async () => {
    const { GET } = await import('@/app/api/bots/info/route')
    const req = asRequest('GET', '/api/bots/info', {
      cookie: admin.sessionCookie,
      query: { bot_id: `nonexistent-${randomUUID()}` },
    })
    const res = await GET(req)
    expect(res.status).toBe(404)
    const body = await parseResponse(res)
    expect(body.error).toBe('bot_not_found')
  })

  it('does NOT resolve a legacy users platform_role=bot row (proves it reads bot_users)', async () => {
    const { GET } = await import('@/app/api/bots/info/route')
    // Create a legacy "bot" the OLD way: a users row with platform_role='bot'.
    // The bridged route reads bot_users, so this id must 404 (not be resolved).
    const legacyId = randomUUID()
    userIds.push(legacyId)
    await ctx.pool.query(
      `INSERT INTO aaelink.users (id, username, email, password_hash, nickname, first_name, platform_role, created_at)
       VALUES ($1, $2, $3, 'x', 'Legacy Bot', 'Legacy', 'bot', $4)`,
      [legacyId, `legacy_bot_${legacyId.slice(0, 8)}`, `legacy-bot-${legacyId.slice(0, 8)}@aaelink.test`, Date.now()]
    )

    const req = asRequest('GET', '/api/bots/info', {
      cookie: admin.sessionCookie,
      query: { bot_id: legacyId },
    })
    const res = await GET(req)
    expect(res.status).toBe(404)
  })
})
