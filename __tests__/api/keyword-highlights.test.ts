/**
 * Integration test: keyword-highlight notifications (P1).
 *
 * matchKeywords was implemented + unit-tested but never called in dispatch.
 * A channel member whose notification_keywords appear (whole-word) in a posted
 * message must now get a kind:'keyword' notification — unless they were already
 * @mentioned in the same message (deduped).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestContext, createTestUser, createTestChannel, asRequest,
  expectSuccess, cleanupTestData, TestContext, TestUser, TestChannel,
} from '../helpers'

let ctx: TestContext
let author: TestUser
let member: TestUser
let channel: TestChannel
let wsId: string
const createdIds: string[] = []
const usernameOf = (u: TestUser) => `test_${u.id.slice(0, 8)}`

async function notifKinds(userId: string, messageId: string): Promise<string[]> {
  const { rows } = await ctx.pool.query<{ kind: string }>(
    `SELECT kind FROM aaelink.notifications WHERE user_id = $1 AND message_id = $2`, [userId, messageId]
  )
  return rows.map(r => r.kind)
}

async function post(message: string): Promise<string> {
  const { POST } = await import('@/app/api/messages/route')
  const body = await expectSuccess<{ id: string }>(await POST(asRequest('POST', '/api/messages', {
    cookie: author.sessionCookie, body: { channel_id: channel.id, message },
  })))
  return body.id
}

beforeAll(async () => {
  ctx = await createTestContext()
  author = await createTestUser(ctx.pool, { role: 'employee' })
  member = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(author.id, member.id)
  const { rows: [m] } = await ctx.pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.workspace_members WHERE user_id = $1 LIMIT 1`, [author.id]
  )
  wsId = m.workspace_id
  channel = await createTestChannel(ctx.pool, author.id, { workspaceId: wsId })
  await ctx.pool.query(
    `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
     VALUES ($1, $2, 'member', $3) ON CONFLICT DO NOTHING`,
    [channel.id, member.id, Date.now()]
  )
  await ctx.pool.query(
    `INSERT INTO aaelink.notification_keywords (user_id, keyword, created_at)
     VALUES ($1, 'deploy', $2) ON CONFLICT DO NOTHING`,
    [member.id, Date.now()]
  )
})

afterAll(async () => {
  await ctx.pool.query(`DELETE FROM aaelink.notification_keywords WHERE user_id = ANY($1)`, [createdIds])
  await ctx.pool.query(`DELETE FROM aaelink.notifications WHERE user_id = ANY($1)`, [createdIds])
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('keyword-highlight notifications', () => {
  it('notifies a member when their keyword appears (whole-word, case-insensitive)', async () => {
    const id = await post('we DEPLOY tonight team')
    expect(await notifKinds(member.id, id)).toContain('keyword')
  })

  it('does not fire on a non-matching message or a partial-word match', async () => {
    const id = await post('redeployment is unrelated')   // "deploy" not a whole word
    expect(await notifKinds(member.id, id)).not.toContain('keyword')
  })

  it('dedupes: an @mentioned member gets only a mention, not also a keyword', async () => {
    const id = await post(`@${usernameOf(member)} please deploy`)
    const kinds = await notifKinds(member.id, id)
    expect(kinds).toContain('mention')
    expect(kinds).not.toContain('keyword')
  })
})
