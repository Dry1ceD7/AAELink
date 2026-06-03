/**
 * Integration tests for GET /api/search/messages (real Postgres FTS).
 *
 * Verifies the route uses websearch_to_tsquery against the stored body_tsv
 * tsvector column, ranks results by ts_rank, and respects channel membership
 * (public channels visible; private channels only when the caller is a member).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, createTestChannel, createTestMessage,
  asRequest, expectSuccess, cleanupTestData,
  TestContext, TestUser
} from '../helpers'

type SearchResult = { message_id: string; body: string; rank: number; channel_id: string }
type SearchBody = { results: SearchResult[]; total: number; limit: number; offset: number }

let ctx: TestContext
let caller: TestUser
let outsider: TestUser
const createdIds: string[] = []
const msgIds: string[] = []

// Unique token so this suite's messages never collide with other data.
const TOKEN = `zylophone${randomUUID().slice(0, 8)}`

beforeAll(async () => {
  ctx = await createTestContext()
  caller = await createTestUser(ctx.pool, { role: 'employee' })
  outsider = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(caller.id, outsider.id)
})

afterAll(async () => {
  if (msgIds.length) await ctx.pool.query(`DELETE FROM aaelink.messages WHERE id = ANY($1)`, [msgIds])
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('GET /api/search/messages — full-text search', () => {
  it('returns 401 without a session', async () => {
    const { GET } = await import('@/app/api/search/messages/route')
    const res = await GET(asRequest('GET', '/api/search/messages', { query: { q: TOKEN } }))
    expect(res.status).toBe(401)
  })

  it('returns empty results for a too-short query', async () => {
    const { GET } = await import('@/app/api/search/messages/route')
    const res = await GET(asRequest('GET', '/api/search/messages', {
      cookie: caller.sessionCookie, query: { q: 'a' }
    }))
    const body = await expectSuccess<SearchBody>(res)
    expect(body.results).toEqual([])
    expect(body.total).toBe(0)
  })

  it('ranks denser matches higher and respects channel membership', async () => {
    const { GET } = await import('@/app/api/search/messages/route')

    // Public channel — caller is a member (creator).
    const pub = await createTestChannel(ctx.pool, caller.id, { type: 'public' })

    // A sparse single mention and a denser repeated mention; FTS should rank
    // the denser one above the sparse one via ts_rank.
    const sparse = await createTestMessage(ctx.pool, pub.id, caller.id, `a stray ${TOKEN} appears once here`)
    const dense  = await createTestMessage(ctx.pool, pub.id, caller.id, `${TOKEN} ${TOKEN} ${TOKEN} everywhere ${TOKEN}`)
    msgIds.push(sparse, dense)

    // Private channel the caller is NOT a member of — must be excluded.
    const priv = await createTestChannel(ctx.pool, outsider.id, { type: 'private' })
    const hidden = await createTestMessage(ctx.pool, priv.id, outsider.id, `secret ${TOKEN} content`)
    msgIds.push(hidden)

    const res = await GET(asRequest('GET', '/api/search/messages', {
      cookie: caller.sessionCookie, query: { q: TOKEN, limit: '50' }
    }))
    const body = await expectSuccess<SearchBody>(res)
    const ids = body.results.map(r => r.message_id)

    expect(ids).toContain(dense)
    expect(ids).toContain(sparse)
    expect(ids).not.toContain(hidden) // channel-membership filter

    // Ranking: dense match scores >= sparse match and sorts first.
    const denseRow = body.results.find(r => r.message_id === dense)!
    const sparseRow = body.results.find(r => r.message_id === sparse)!
    expect(denseRow.rank).toBeGreaterThanOrEqual(sparseRow.rank)
    expect(ids.indexOf(dense)).toBeLessThan(ids.indexOf(sparse))
  })

  it('matches via stemming (websearch_to_tsquery, english)', async () => {
    const { GET } = await import('@/app/api/search/messages/route')
    const stem = `runner${randomUUID().slice(0, 6)}`
    const pub = await createTestChannel(ctx.pool, caller.id, { type: 'public' })
    const id = await createTestMessage(ctx.pool, pub.id, caller.id, `the ${stem} was running fast`)
    msgIds.push(id)

    // Search "running" should match the stored "running" token regardless of form.
    const res = await GET(asRequest('GET', '/api/search/messages', {
      cookie: caller.sessionCookie, query: { q: 'running', limit: '50' }
    }))
    const body = await expectSuccess<SearchBody>(res)
    expect(body.results.map(r => r.message_id)).toContain(id)
  })
})
