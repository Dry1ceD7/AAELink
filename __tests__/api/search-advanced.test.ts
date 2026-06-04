/**
 * Integration tests for GET /api/search/advanced (Slack-style inline operator
 * grammar over the shared Postgres-FTS engine).
 *
 * Pins the route's parsing + delegation contract that previously had zero
 * coverage:
 *   - operator extraction surfaces in the `echo` (response `filters`) object
 *   - `from:` / `in:#name` / `has:file` / `is:pinned` flow through to results
 *   - FILTER-ONLY queries (no free-text keyword) still return matches — this is
 *     the regression the adversarial review flagged: the route used to
 *     short-circuit to empty whenever the residual keyword was < 2 chars, even
 *     when operators were present.
 *   - a genuinely-empty query (no keyword AND no operators) yields the empty shape
 *   - keyword text is stripped of operators before hitting FTS
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, createTestChannel, createTestMessage,
  asRequest, expectSuccess, cleanupTestData,
  TestContext, TestUser
} from '../helpers'

type AdvResult = {
  message_id: string; body: string; channel_id: string; channel_name: string
  author_username: string; highlight: string
}
type AdvBody = {
  query: string; keywords: string
  filters: Record<string, unknown>
  results: AdvResult[]; total: number; limit: number; offset: number
}

async function pinMessage(pool: TestContext['pool'], channelId: string, messageId: string, userId: string) {
  await pool.query(
    `INSERT INTO aaelink.pinned_messages (channel_id, message_id, pinned_by, pinned_at)
     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [channelId, messageId, userId, Date.now()]
  )
}

let ctx: TestContext
let caller: TestUser
let workspaceId: string
const createdIds: string[] = []
const msgIds: string[] = []

const TOKEN = `advtok${randomUUID().slice(0, 8)}`

beforeAll(async () => {
  ctx = await createTestContext()
  caller = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(caller.id)
  const { rows } = await ctx.pool.query<{ id: string }>(
    `SELECT workspace_id AS id FROM aaelink.workspace_members WHERE user_id = $1 ORDER BY workspace_id LIMIT 1`,
    [caller.id]
  )
  workspaceId = rows[0].id
})

afterAll(async () => {
  if (msgIds.length) await ctx.pool.query(`DELETE FROM aaelink.messages WHERE id = ANY($1)`, [msgIds])
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('GET /api/search/advanced — auth + empty shape', () => {
  it('returns 401 without a session', async () => {
    const { GET } = await import('@/app/api/search/advanced/route')
    const res = await GET(asRequest('GET', '/api/search/advanced', { query: { q: TOKEN, workspace_id: workspaceId } }))
    expect(res.status).toBe(401)
  })

  it('requires workspace_id', async () => {
    const { GET } = await import('@/app/api/search/advanced/route')
    const res = await GET(asRequest('GET', '/api/search/advanced', {
      cookie: caller.sessionCookie, query: { q: TOKEN }
    }))
    expect(res.status).toBe(400)
  })

  it('returns the empty shape for a query with no keyword AND no operators', async () => {
    const { GET } = await import('@/app/api/search/advanced/route')
    const res = await GET(asRequest('GET', '/api/search/advanced', {
      cookie: caller.sessionCookie, query: { q: 'a', workspace_id: workspaceId }
    }))
    const body = await expectSuccess<AdvBody>(res)
    expect(body.results).toEqual([])
    expect(body.total).toBe(0)
  })
})

describe('GET /api/search/advanced — operator extraction (echo)', () => {
  it('extracts from / in / has / is / date operators into the echoed filters and strips them from keywords', async () => {
    const { GET } = await import('@/app/api/search/advanced/route')
    const q = `from:${caller.email} in:#general has:file is:pinned before:2025-01-01 ${TOKEN}`
    const res = await GET(asRequest('GET', '/api/search/advanced', {
      cookie: caller.sessionCookie, query: { q, workspace_id: workspaceId }
    }))
    const body = await expectSuccess<AdvBody>(res)
    // The residual keyword is just the free-text token; all operators stripped.
    expect(body.keywords).toBe(TOKEN)
    expect(body.filters.from).toBe(caller.email)
    expect(body.filters.in).toBe('general')
    expect(body.filters.has).toEqual(['file'])
    expect(body.filters.isPinned).toBe(true)
    expect(body.filters.before).toBe('2025-01-01')
  })
})

describe('GET /api/search/advanced — filter-only queries return matches (regression)', () => {
  it('is:pinned with no free-text keyword returns pinned matches (not an empty short-circuit)', async () => {
    const { GET } = await import('@/app/api/search/advanced/route')
    const tok = `pinonly${randomUUID().slice(0, 6)}`
    const pub = await createTestChannel(ctx.pool, caller.id, { type: 'public', workspaceId })
    const pinned = await createTestMessage(ctx.pool, pub.id, caller.id, `${tok} keep this pinned`)
    const loose = await createTestMessage(ctx.pool, pub.id, caller.id, `${tok} not pinned`)
    msgIds.push(pinned, loose)
    await pinMessage(ctx.pool, pub.id, pinned, caller.id)

    // NO free-text keyword — only the operator. The old route returned [] here.
    const res = await GET(asRequest('GET', '/api/search/advanced', {
      cookie: caller.sessionCookie, query: { q: 'is:pinned', workspace_id: workspaceId, limit: '50' }
    }))
    const body = await expectSuccess<AdvBody>(res)
    const ids = body.results.map(r => r.message_id)
    expect(body.keywords).toBe('')
    expect(ids).toContain(pinned)
    expect(ids).not.toContain(loose)
    expect(body.total).toBeGreaterThanOrEqual(1)
  })

  it('from:<username> filter-only query returns that author\'s messages', async () => {
    const { GET } = await import('@/app/api/search/advanced/route')
    const tok = `fromonly${randomUUID().slice(0, 6)}`
    const other = await createTestUser(ctx.pool, { role: 'employee' })
    createdIds.push(other.id)
    const pub = await createTestChannel(ctx.pool, caller.id, { type: 'public', workspaceId })
    // both users post into the same public channel
    await ctx.pool.query(
      `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
       VALUES ($1, $2, 'member', $3) ON CONFLICT DO NOTHING`,
      [pub.id, other.id, Date.now()]
    )
    const mine = await createTestMessage(ctx.pool, pub.id, caller.id, `${tok} mine`)
    const theirs = await createTestMessage(ctx.pool, pub.id, other.id, `${tok} theirs`)
    msgIds.push(mine, theirs)

    // caller's username is `test_<suffix>`; resolve it.
    const { rows } = await ctx.pool.query<{ username: string }>(
      `SELECT username FROM aaelink.users WHERE id = $1`, [caller.id]
    )
    const uname = rows[0].username

    const res = await GET(asRequest('GET', '/api/search/advanced', {
      cookie: caller.sessionCookie, query: { q: `from:${uname}`, workspace_id: workspaceId, limit: '50' }
    }))
    const body = await expectSuccess<AdvBody>(res)
    const ids = body.results.map(r => r.message_id)
    expect(ids).toContain(mine)
    expect(ids).not.toContain(theirs)
  })
})

describe('GET /api/search/advanced — keyword + operator combined', () => {
  it('is:pinned plus a free-text keyword AND-combines (pinned matches containing the term)', async () => {
    const { GET } = await import('@/app/api/search/advanced/route')
    const tok = `combo${randomUUID().slice(0, 6)}`
    const pub = await createTestChannel(ctx.pool, caller.id, { type: 'public', workspaceId })
    const pinnedHit = await createTestMessage(ctx.pool, pub.id, caller.id, `${tok} pinned and matching`)
    const pinnedMiss = await createTestMessage(ctx.pool, pub.id, caller.id, `pinned but no term here`)
    const loose = await createTestMessage(ctx.pool, pub.id, caller.id, `${tok} matching but not pinned`)
    msgIds.push(pinnedHit, pinnedMiss, loose)
    await pinMessage(ctx.pool, pub.id, pinnedHit, caller.id)
    await pinMessage(ctx.pool, pub.id, pinnedMiss, caller.id)

    const res = await GET(asRequest('GET', '/api/search/advanced', {
      cookie: caller.sessionCookie, query: { q: `is:pinned ${tok}`, workspace_id: workspaceId, limit: '50' }
    }))
    const body = await expectSuccess<AdvBody>(res)
    const ids = body.results.map(r => r.message_id)
    expect(body.keywords).toBe(tok)
    expect(ids).toContain(pinnedHit)
    expect(ids).not.toContain(pinnedMiss) // pinned but doesn't match the keyword
    expect(ids).not.toContain(loose)      // matches keyword but not pinned
  })
})
