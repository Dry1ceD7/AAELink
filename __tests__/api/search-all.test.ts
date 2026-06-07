/**
 * Integration tests for GET /api/search/all (combined Slack search.all parity).
 *
 * Verifies:
 *   - All three facets (messages, files, people) are returned in one call.
 *   - counts equal the number of items RETURNED in each facet (post-filter, post-limit).
 *   - Channel ACL is preserved: messages from channels the caller cannot read
 *     never appear in the messages facet.
 *   - Per-facet limit is respected (each facet is truncated when enough rows exist).
 *   - Information-barrier filtering: people blocked by block_search=true barriers
 *     never appear in the people facet.
 *   - Auth guard: 401 without a session.
 *   - Short-query guard: empty facets for q < 2 chars.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, createTestChannel, createTestMessage,
  asRequest, expectSuccess, cleanupTestData,
  TestContext, TestUser
} from '../helpers'

type MessageHit = { message_id: string; body: string; channel_id: string }
type FileHit = { id: string; file_id: string; filename: string }
type UserHit = { id: string; username: string; email: string }
type AllBody = {
  messages: MessageHit[]
  files: FileHit[]
  people: UserHit[]
  counts: { messages: number; files: number; people: number }
}

let ctx: TestContext
let caller: TestUser
let outsider: TestUser
const createdIds: string[] = []
const msgIds: string[] = []
const fileIds: string[] = []
const barrierIds: string[] = []

// Unique token so this suite never collides with other test data.
const TOKEN = `allsrch${randomUUID().slice(0, 8)}`

beforeAll(async () => {
  ctx = await createTestContext()
  caller = await createTestUser(ctx.pool, { role: 'employee' })
  outsider = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(caller.id, outsider.id)
})

afterAll(async () => {
  if (barrierIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.information_barriers WHERE id = ANY($1)`, [barrierIds])
  }
  if (msgIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.messages WHERE id = ANY($1)`, [msgIds])
  }
  if (fileIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.file_index WHERE file_id = ANY($1)`, [fileIds])
  }
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

// ── Auth + guard ─────────────────────────────────────────────────────

describe('GET /api/search/all — auth + guards', () => {
  it('returns 401 without a session', async () => {
    const { GET } = await import('@/app/api/search/all/route')
    const res = await GET(asRequest('GET', '/api/search/all', { query: { q: TOKEN } }))
    expect(res.status).toBe(401)
  })

  it('returns empty facets for a too-short query (< 2 chars)', async () => {
    const { GET } = await import('@/app/api/search/all/route')
    const res = await GET(asRequest('GET', '/api/search/all', {
      cookie: caller.sessionCookie, query: { q: 'a' }
    }))
    const body = await expectSuccess<AllBody>(res)
    expect(body.messages).toEqual([])
    expect(body.files).toEqual([])
    expect(body.people).toEqual([])
    expect(body.counts).toEqual({ messages: 0, files: 0, people: 0 })
  })
})

// ── All-three-facets happy path ──────────────────────────────────────

describe('GET /api/search/all — three-facet combined result', () => {
  let seedMsgId: string
  let seedFileId: string

  beforeAll(async () => {
    // Seed a message in a public channel so the caller can read it.
    const pub = await createTestChannel(ctx.pool, caller.id, { type: 'public' })
    seedMsgId = await createTestMessage(ctx.pool, pub.id, caller.id, `content about ${TOKEN} topic`)
    msgIds.push(seedMsgId)

    // Seed a file whose content contains the token.
    seedFileId = randomUUID()
    fileIds.push(seedFileId)
    const { POST } = await import('@/app/api/search/files/route')
    await POST(asRequest('POST', '/api/search/files', {
      cookie: caller.sessionCookie,
      body: {
        file_id: seedFileId,
        filename: `${TOKEN}-report.txt`,
        file_type: 'txt',
        content: `quarterly ${TOKEN} summary notes for the team`,
      },
    }))

    // The caller user already has the TOKEN in their username prefix via the
    // unique suffix — use a dedicated user whose email contains TOKEN to ensure
    // the people facet matches. Re-use the outsider user: update their email.
    await ctx.pool.query(
      `UPDATE aaelink.users SET email = $1 WHERE id = $2`,
      [`${TOKEN}@aaelink.test`, outsider.id]
    )
  })

  it('returns hits in all three facets and counts equal returned array lengths', async () => {
    const { GET } = await import('@/app/api/search/all/route')
    const res = await GET(asRequest('GET', '/api/search/all', {
      cookie: caller.sessionCookie, query: { q: TOKEN, limit: '25' }
    }))
    const body = await expectSuccess<AllBody>(res)

    // Messages facet
    expect(body.messages.map(m => m.message_id)).toContain(seedMsgId)
    expect(body.counts.messages).toBe(body.messages.length)

    // Files facet
    expect(body.files.map(f => f.file_id)).toContain(seedFileId)
    expect(body.counts.files).toBe(body.files.length)

    // People facet — outsider email now contains TOKEN
    expect(body.people.map(p => p.id)).toContain(outsider.id)
    expect(body.counts.people).toBe(body.people.length)
  })

  it('facet item shapes match standalone routes (message_id, file_id, username fields present)', async () => {
    const { GET } = await import('@/app/api/search/all/route')
    const res = await GET(asRequest('GET', '/api/search/all', {
      cookie: caller.sessionCookie, query: { q: TOKEN, limit: '25' }
    }))
    const body = await expectSuccess<AllBody>(res)

    // Message shape (identical to /search/messages)
    const msg = body.messages.find(m => m.message_id === seedMsgId)
    expect(msg).toBeDefined()
    expect(msg).toHaveProperty('message_id')
    expect(msg).toHaveProperty('body')
    expect(msg).toHaveProperty('channel_id')
    expect(msg).toHaveProperty('rank')
    expect(msg).toHaveProperty('highlight')

    // File shape (identical to /search/files results[])
    const file = body.files.find(f => f.file_id === seedFileId)
    expect(file).toBeDefined()
    expect(file).toHaveProperty('file_id')
    expect(file).toHaveProperty('filename')
    expect(file).toHaveProperty('file_type')
    expect(file).toHaveProperty('highlights')

    // People shape (identical to /search/users users[])
    const person = body.people.find(p => p.id === outsider.id)
    expect(person).toBeDefined()
    expect(person).toHaveProperty('id')
    expect(person).toHaveProperty('username')
    expect(person).toHaveProperty('email')
  })
})

// ── ACL: messages from unreadable channels must not appear ───────────

describe('GET /api/search/all — channel ACL preserved', () => {
  it('does not return messages from private channels the caller cannot read', async () => {
    const { GET } = await import('@/app/api/search/all/route')

    // Private channel owned by outsider; caller is NOT a member.
    const priv = await createTestChannel(ctx.pool, outsider.id, { type: 'private' })
    const hiddenMsgId = await createTestMessage(
      ctx.pool, priv.id, outsider.id, `classified ${TOKEN} briefing`
    )
    msgIds.push(hiddenMsgId)

    const res = await GET(asRequest('GET', '/api/search/all', {
      cookie: caller.sessionCookie, query: { q: TOKEN, limit: '25' }
    }))
    const body = await expectSuccess<AllBody>(res)
    expect(body.messages.map(m => m.message_id)).not.toContain(hiddenMsgId)
  })
})

// ── Information-barrier filtering on people facet ────────────────────

describe('GET /api/search/all — information-barrier filtering on people facet', () => {
  it('returns zero people hits when the only matching user is in an opposing barrier group (block_search=true)', async () => {
    // Create two users in opposing barrier groups.
    const searcher = await createTestUser(ctx.pool, { role: 'employee' })
    const target = await createTestUser(ctx.pool, { role: 'employee' })
    createdIds.push(searcher.id, target.id)

    // Give target an email containing a unique token so the people facet would
    // match exactly target — no collateral noise.
    const barrierToken = `bsearch${randomUUID().slice(0, 8)}`
    await ctx.pool.query(
      `UPDATE aaelink.users SET email = $1 WHERE id = $2`,
      [`${barrierToken}@aaelink.test`, target.id]
    )

    // Insert a barrier: searcher in group_a, target in group_b, block_search=true.
    const barrierId = randomUUID()
    await ctx.pool.query(
      `INSERT INTO aaelink.information_barriers
         (id, name, type, description, group_a_ids, group_b_ids, block_dm, block_channels, block_search, block_file_share, is_active, created_by, created_at)
       VALUES ($1, $2, 'custom', '', $3, $4, false, false, true, false, true, $5, $6)`,
      [barrierId, `bs-${barrierId.slice(0, 8)}`, JSON.stringify([searcher.id]), JSON.stringify([target.id]), searcher.id, Date.now()]
    )
    barrierIds.push(barrierId)

    const { GET } = await import('@/app/api/search/all/route')
    const res = await GET(asRequest('GET', '/api/search/all', {
      cookie: searcher.sessionCookie, query: { q: barrierToken, limit: '25' }
    }))
    const body = await expectSuccess<AllBody>(res)

    // The target must not appear in the people facet due to the barrier.
    expect(body.people.map(p => p.id)).not.toContain(target.id)
    expect(body.counts.people).toBe(0)
  })
})

// ── Per-facet limit ──────────────────────────────────────────────────

describe('GET /api/search/all — per-facet limit', () => {
  it('caps each facet at the requested limit and counts equal returned lengths', async () => {
    // Seed 2 extra messages so the messages facet has >1 match.
    const pub = await createTestChannel(ctx.pool, caller.id, { type: 'public' })
    const extra1 = await createTestMessage(ctx.pool, pub.id, caller.id, `extra ${TOKEN} alpha message`)
    const extra2 = await createTestMessage(ctx.pool, pub.id, caller.id, `extra ${TOKEN} beta message`)
    msgIds.push(extra1, extra2)

    // Seed 2 extra files so the files facet has >1 match.
    const { POST: postFile } = await import('@/app/api/search/files/route')
    for (const suffix of ['capA', 'capB']) {
      const fid = randomUUID()
      fileIds.push(fid)
      await postFile(asRequest('POST', '/api/search/files', {
        cookie: caller.sessionCookie,
        body: {
          file_id: fid,
          filename: `${TOKEN}-cap-${suffix}.txt`,
          file_type: 'txt',
          content: `${TOKEN} cap test ${suffix}`,
        },
      }))
    }

    // Seed 2 extra users whose email contains TOKEN so the people facet has >1 match.
    for (const _ of [1, 2]) {
      const u = await createTestUser(ctx.pool, { role: 'employee' })
      createdIds.push(u.id)
      await ctx.pool.query(
        `UPDATE aaelink.users SET email = $1 WHERE id = $2`,
        [`${TOKEN}-cap-${u.id.slice(0, 6)}@aaelink.test`, u.id]
      )
    }

    const { GET } = await import('@/app/api/search/all/route')
    const res = await GET(asRequest('GET', '/api/search/all', {
      cookie: caller.sessionCookie, query: { q: TOKEN, limit: '1' }
    }))
    const body = await expectSuccess<AllBody>(res)

    // Each facet must be truncated to exactly the requested limit.
    expect(body.messages.length).toBe(1)
    expect(body.files.length).toBe(1)
    expect(body.people.length).toBe(1)

    // counts always equal the number of items returned (post-filter, post-limit).
    expect(body.counts.messages).toBe(1)
    expect(body.counts.files).toBe(1)
    expect(body.counts.people).toBe(1)
  })
})
