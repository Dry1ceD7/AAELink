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

type SearchResult = {
  message_id: string; body: string; rank: number; channel_id: string
  highlight?: string; root_id?: string | null; channel_name?: string
}
type SearchBody = { results: SearchResult[]; total: number; limit: number; offset: number }

async function addReaction(pool: TestContext['pool'], messageId: string, userId: string) {
  await pool.query(
    `INSERT INTO aaelink.message_reactions (message_id, user_id, reaction_key, created_at)
     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [messageId, userId, ':thumbsup:', Date.now()]
  )
}

async function pinMessage(pool: TestContext['pool'], channelId: string, messageId: string, userId: string) {
  await pool.query(
    `INSERT INTO aaelink.pinned_messages (channel_id, message_id, pinned_by, pinned_at)
     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [channelId, messageId, userId, Date.now()]
  )
}

/** Force a message's created_at so date-window filters are deterministic. */
async function setCreatedAt(pool: TestContext['pool'], messageId: string, ms: number) {
  await pool.query(`UPDATE aaelink.messages SET created_at = $2 WHERE id = $1`, [messageId, ms])
}

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

  it('returns a server-side highlight marking the stemmed match', async () => {
    const { GET } = await import('@/app/api/search/messages/route')
    const tok = `glint${randomUUID().slice(0, 6)}`
    const pub = await createTestChannel(ctx.pool, caller.id, { type: 'public' })
    const id = await createTestMessage(ctx.pool, pub.id, caller.id, `the lights were ${tok}ing brightly tonight`)
    msgIds.push(id)

    const res = await GET(asRequest('GET', '/api/search/messages', {
      cookie: caller.sessionCookie, query: { q: `${tok}ing`, limit: '50' }
    }))
    const body = await expectSuccess<SearchBody>(res)
    const hit = body.results.find(r => r.message_id === id)
    expect(hit).toBeDefined()
    expect(hit!.highlight).toBeTruthy()
    // ts_headline wraps the matched (stemmed) token in <mark>…</mark>.
    expect(hit!.highlight!).toContain('<mark>')
    expect(hit!.highlight!.toLowerCase()).toContain(`${tok}ing`.toLowerCase())
  })
})

describe('GET /api/search/messages — has: / is: operators', () => {
  it('has=reaction filters to messages with a reaction (real message_reactions table)', async () => {
    const { GET } = await import('@/app/api/search/messages/route')
    const tok = `reactme${randomUUID().slice(0, 6)}`
    const pub = await createTestChannel(ctx.pool, caller.id, { type: 'public' })
    const withReaction = await createTestMessage(ctx.pool, pub.id, caller.id, `please ${tok} this one`)
    const without = await createTestMessage(ctx.pool, pub.id, caller.id, `do not ${tok} this one`)
    msgIds.push(withReaction, without)
    await addReaction(ctx.pool, withReaction, caller.id)

    const res = await GET(asRequest('GET', '/api/search/messages', {
      cookie: caller.sessionCookie, query: { q: tok, has: 'reaction', limit: '50' }
    }))
    const body = await expectSuccess<SearchBody>(res)
    const ids = body.results.map(r => r.message_id)
    expect(ids).toContain(withReaction)
    expect(ids).not.toContain(without)
  })

  it('has=pin filters to pinned messages', async () => {
    const { GET } = await import('@/app/api/search/messages/route')
    const tok = `pinme${randomUUID().slice(0, 6)}`
    const pub = await createTestChannel(ctx.pool, caller.id, { type: 'public' })
    const pinned = await createTestMessage(ctx.pool, pub.id, caller.id, `${tok} keep this`)
    const loose = await createTestMessage(ctx.pool, pub.id, caller.id, `${tok} forget this`)
    msgIds.push(pinned, loose)
    await pinMessage(ctx.pool, pub.id, pinned, caller.id)

    const res = await GET(asRequest('GET', '/api/search/messages', {
      cookie: caller.sessionCookie, query: { q: tok, has: 'pin', limit: '50' }
    }))
    const body = await expectSuccess<SearchBody>(res)
    const ids = body.results.map(r => r.message_id)
    expect(ids).toContain(pinned)
    expect(ids).not.toContain(loose)
  })

  it('is=thread filters to thread replies (root_id <> "")', async () => {
    const { GET } = await import('@/app/api/search/messages/route')
    const tok = `thrd${randomUUID().slice(0, 6)}`
    const pub = await createTestChannel(ctx.pool, caller.id, { type: 'public' })
    const root = await createTestMessage(ctx.pool, pub.id, caller.id, `${tok} root post`)
    // A reply carries a non-empty root_id.
    const replyId = randomUUID()
    await ctx.pool.query(
      `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      [replyId, pub.id, caller.id, `${tok} a threaded reply`, root, Date.now()]
    )
    msgIds.push(root, replyId)

    const res = await GET(asRequest('GET', '/api/search/messages', {
      cookie: caller.sessionCookie, query: { q: tok, is: 'thread', limit: '50' }
    }))
    const body = await expectSuccess<SearchBody>(res)
    const ids = body.results.map(r => r.message_id)
    expect(ids).toContain(replyId)
    expect(ids).not.toContain(root)
  })
})

describe('GET /api/search/messages — date windows (on / during)', () => {
  it('on=YYYY-MM-DD matches only that calendar day', async () => {
    const { GET } = await import('@/app/api/search/messages/route')
    const tok = `dayfilter${randomUUID().slice(0, 6)}`
    const pub = await createTestChannel(ctx.pool, caller.id, { type: 'public' })
    const onDay = await createTestMessage(ctx.pool, pub.id, caller.id, `${tok} on the target day`)
    const offDay = await createTestMessage(ctx.pool, pub.id, caller.id, `${tok} a different day`)
    msgIds.push(onDay, offDay)
    // UTC noon on the target day, and a day before.
    await setCreatedAt(ctx.pool, onDay, Date.UTC(2025, 2, 15, 12, 0, 0))
    await setCreatedAt(ctx.pool, offDay, Date.UTC(2025, 2, 14, 12, 0, 0))

    const res = await GET(asRequest('GET', '/api/search/messages', {
      cookie: caller.sessionCookie, query: { q: tok, on: '2025-03-15', limit: '50' }
    }))
    const body = await expectSuccess<SearchBody>(res)
    const ids = body.results.map(r => r.message_id)
    expect(ids).toContain(onDay)
    expect(ids).not.toContain(offDay)
  })

  it('during=YYYY-MM matches only that month', async () => {
    const { GET } = await import('@/app/api/search/messages/route')
    const tok = `monthfilter${randomUUID().slice(0, 6)}`
    const pub = await createTestChannel(ctx.pool, caller.id, { type: 'public' })
    const inMonth = await createTestMessage(ctx.pool, pub.id, caller.id, `${tok} inside june`)
    const outMonth = await createTestMessage(ctx.pool, pub.id, caller.id, `${tok} inside july`)
    msgIds.push(inMonth, outMonth)
    await setCreatedAt(ctx.pool, inMonth, Date.UTC(2025, 5, 10, 9, 0, 0)) // June
    await setCreatedAt(ctx.pool, outMonth, Date.UTC(2025, 6, 10, 9, 0, 0)) // July

    const res = await GET(asRequest('GET', '/api/search/messages', {
      cookie: caller.sessionCookie, query: { q: tok, during: '2025-06', limit: '50' }
    }))
    const body = await expectSuccess<SearchBody>(res)
    const ids = body.results.map(r => r.message_id)
    expect(ids).toContain(inMonth)
    expect(ids).not.toContain(outMonth)
  })
})

describe('GET /api/search/messages — channel_name resolution + no-leak', () => {
  it('resolves channel_name to a readable channel and excludes other channels', async () => {
    const { GET } = await import('@/app/api/search/messages/route')
    const tok = `chanfilter${randomUUID().slice(0, 6)}`
    const name = `target-${randomUUID().slice(0, 8)}`
    const target = await createTestChannel(ctx.pool, caller.id, { type: 'public', name })
    const other = await createTestChannel(ctx.pool, caller.id, { type: 'public' })
    const here = await createTestMessage(ctx.pool, target.id, caller.id, `${tok} in target channel`)
    const elsewhere = await createTestMessage(ctx.pool, other.id, caller.id, `${tok} in other channel`)
    msgIds.push(here, elsewhere)

    const res = await GET(asRequest('GET', '/api/search/messages', {
      cookie: caller.sessionCookie, query: { q: tok, channel_name: name, limit: '50' }
    }))
    const body = await expectSuccess<SearchBody>(res)
    const ids = body.results.map(r => r.message_id)
    expect(ids).toContain(here)
    expect(ids).not.toContain(elsewhere)
  })

  it('does not leak a private channel the caller cannot read via channel_name', async () => {
    const { GET } = await import('@/app/api/search/messages/route')
    const tok = `secretchan${randomUUID().slice(0, 6)}`
    const name = `hidden-${randomUUID().slice(0, 8)}`
    // Private channel owned by the outsider; caller is NOT a member.
    const priv = await createTestChannel(ctx.pool, outsider.id, { type: 'private', name })
    const secret = await createTestMessage(ctx.pool, priv.id, outsider.id, `${tok} in a private channel`)
    msgIds.push(secret)

    const res = await GET(asRequest('GET', '/api/search/messages', {
      cookie: caller.sessionCookie, query: { q: tok, channel_name: name, limit: '50' }
    }))
    const body = await expectSuccess<SearchBody>(res)
    // Unreadable name behaves as no-match: zero results, existence not revealed.
    expect(body.results.map(r => r.message_id)).not.toContain(secret)
    expect(body.total).toBe(0)
  })
})

describe('GET /api/search/messages — sort modes', () => {
  it('sort=recent orders newest first; sort=relevance orders by rank', async () => {
    const { GET } = await import('@/app/api/search/messages/route')
    const tok = `sortme${randomUUID().slice(0, 6)}`
    const pub = await createTestChannel(ctx.pool, caller.id, { type: 'public' })
    // older = denser match (higher rank); newer = sparse match.
    const older = await createTestMessage(ctx.pool, pub.id, caller.id, `${tok} ${tok} ${tok} dense old`)
    const newer = await createTestMessage(ctx.pool, pub.id, caller.id, `${tok} sparse new`)
    msgIds.push(older, newer)
    await setCreatedAt(ctx.pool, older, Date.UTC(2024, 0, 1, 0, 0, 0))
    await setCreatedAt(ctx.pool, newer, Date.UTC(2024, 0, 2, 0, 0, 0))

    const recentRes = await GET(asRequest('GET', '/api/search/messages', {
      cookie: caller.sessionCookie, query: { q: tok, sort: 'recent', limit: '50' }
    }))
    const recent = await expectSuccess<SearchBody>(recentRes)
    const recentIds = recent.results.map(r => r.message_id)
    expect(recentIds.indexOf(newer)).toBeLessThan(recentIds.indexOf(older))

    const relRes = await GET(asRequest('GET', '/api/search/messages', {
      cookie: caller.sessionCookie, query: { q: tok, sort: 'relevance', limit: '50' }
    }))
    const rel = await expectSuccess<SearchBody>(relRes)
    const relIds = rel.results.map(r => r.message_id)
    // Denser (older) message ranks above the sparse (newer) one under relevance.
    expect(relIds.indexOf(older)).toBeLessThan(relIds.indexOf(newer))
  })
})
