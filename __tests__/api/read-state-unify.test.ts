/**
 * Integration test: read-state unification (migration 028).
 *
 * mark-unread, conversations.mark, and collab/read-state previously split their
 * cursor writes between `read_state` and `channel_read_state`, so marking a
 * channel read in one path left it unread in another. All three must now
 * converge on a single `channel_read_state` row, and the orphan `read_state`
 * table must be gone.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestContext, createTestUser, createTestChannel, asRequest,
  expectSuccess, cleanupTestData, TestContext, TestUser, TestChannel,
} from '../helpers'

let ctx: TestContext
let user: TestUser
let channel: TestChannel
const createdIds: string[] = []

async function cursor(channelId: string, userId: string): Promise<number | null> {
  const { rows } = await ctx.pool.query<{ last_read_at: string }>(
    `SELECT last_read_at FROM aaelink.channel_read_state WHERE user_id = $1 AND channel_id = $2`,
    [userId, channelId]
  )
  return rows[0] ? Number(rows[0].last_read_at) : null
}

beforeAll(async () => {
  ctx = await createTestContext()
  user = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(user.id)
  channel = await createTestChannel(ctx.pool, user.id)
})

afterAll(async () => {
  await ctx.pool.query(`DELETE FROM aaelink.channel_read_state WHERE user_id = ANY($1)`, [createdIds])
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('read-state unification', () => {
  it('dropped the orphan read_state table (migration 028)', async () => {
    const { rows } = await ctx.pool.query<{ t: string | null }>(`SELECT to_regclass('aaelink.read_state') AS t`)
    expect(rows[0].t).toBeNull()
  })

  it('conversations.mark writes the unified channel_read_state cursor', async () => {
    const { POST } = await import('@/app/api/conversations/mark/route')
    const res = await POST(asRequest('POST', '/api/conversations/mark', {
      cookie: user.sessionCookie, body: { channel: channel.id, ts: '200' },
    }))
    await expectSuccess(res)
    expect(await cursor(channel.id, user.id)).toBe(200)
  })

  it('collab/read-state (set) updates the same row conversations.mark wrote', async () => {
    const { POST } = await import('@/app/api/collab/read-state/route')
    const res = await POST(asRequest('POST', '/api/collab/read-state', {
      cookie: user.sessionCookie, body: { channel_id: channel.id, last_read_at: 500, mode: 'set' },
    }))
    await expectSuccess(res)
    expect(await cursor(channel.id, user.id)).toBe(500)
  })

  it('mark-unread rewinds the same unified cursor', async () => {
    const { POST } = await import('@/app/api/collab/mark-unread/route')
    const res = await POST(asRequest('POST', '/api/collab/mark-unread', {
      cookie: user.sessionCookie, body: { channel_id: channel.id, from_create_at: 300 },
    }))
    await expectSuccess(res)
    // rewindTo = from_create_at - 1, written via plain SET (backward allowed)
    expect(await cursor(channel.id, user.id)).toBe(299)
  })

  it('rejects (403, not 500) a mark against a non-existent channel — FK guard', async () => {
    const mark = await import('@/app/api/conversations/mark/route')
    const markRes = await mark.POST(asRequest('POST', '/api/conversations/mark', {
      cookie: user.sessionCookie, body: { channel: 'no-such-channel', ts: '100' },
    }))
    expect(markRes.status).toBe(403)

    const unread = await import('@/app/api/collab/mark-unread/route')
    const unreadRes = await unread.POST(asRequest('POST', '/api/collab/mark-unread', {
      cookie: user.sessionCookie, body: { channel_id: 'no-such-channel', from_create_at: 100 },
    }))
    expect(unreadRes.status).toBe(403)
  })
})
