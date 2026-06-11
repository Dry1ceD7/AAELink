/**
 * Integration test: channel_notification_prefs.level enforcement (P1).
 *
 * `level` was stored but no dispatch path read it. Now:
 *   - 'all'      → notified on every message (kind 'channel_message')
 *   - 'mentions'/'default' → only on @mention (unchanged)
 *   - 'nothing'  → suppressed entirely, even on @mention
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestContext, createTestUser, createTestChannel, asRequest,
  expectSuccess, cleanupTestData, TestContext, TestUser, TestChannel,
} from '../helpers'

let ctx: TestContext
let author: TestUser
let allMember: TestUser
let nothingMember: TestUser
let defMember: TestUser
let mutedAllMember: TestUser
let kwAllMember: TestUser
let channel: TestChannel
let wsId: string
const createdIds: string[] = []
const usernameOf = (u: TestUser) => `test_${u.id.slice(0, 8)}`

async function addMember(userId: string) {
  await ctx.pool.query(
    `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
     VALUES ($1, $2, 'member', $3) ON CONFLICT DO NOTHING`, [channel.id, userId, Date.now()]
  )
}
async function setLevel(userId: string, level: string) {
  await ctx.pool.query(
    `INSERT INTO aaelink.channel_notification_prefs (user_id, channel_id, level, muted, updated_at)
     VALUES ($1, $2, $3, false, $4)
     ON CONFLICT (user_id, channel_id) DO UPDATE SET level = EXCLUDED.level`,
    [userId, channel.id, level, Date.now()]
  )
}
async function kinds(userId: string, messageId: string): Promise<string[]> {
  const { rows } = await ctx.pool.query<{ kind: string }>(
    `SELECT kind FROM aaelink.notifications WHERE user_id = $1 AND message_id = $2`, [userId, messageId]
  )
  return rows.map(r => r.kind)
}
async function post(message: string): Promise<string> {
  const { POST } = await import('@/app/api/messages/route')
  const b = await expectSuccess<{ id: string }>(await POST(asRequest('POST', '/api/messages', {
    cookie: author.sessionCookie, body: { channel_id: channel.id, message },
  })))
  return b.id
}

beforeAll(async () => {
  ctx = await createTestContext()
  author = await createTestUser(ctx.pool, { role: 'employee' })
  allMember = await createTestUser(ctx.pool, { role: 'employee' })
  nothingMember = await createTestUser(ctx.pool, { role: 'employee' })
  defMember = await createTestUser(ctx.pool, { role: 'employee' })
  mutedAllMember = await createTestUser(ctx.pool, { role: 'employee' })
  kwAllMember = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(author.id, allMember.id, nothingMember.id, defMember.id, mutedAllMember.id, kwAllMember.id)
  const { rows: [m] } = await ctx.pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.workspace_members WHERE user_id = $1 LIMIT 1`, [author.id]
  )
  wsId = m.workspace_id
  channel = await createTestChannel(ctx.pool, author.id, { workspaceId: wsId })
  for (const u of [allMember, nothingMember, defMember, mutedAllMember, kwAllMember]) await addMember(u.id)
  await setLevel(allMember.id, 'all')
  await setLevel(nothingMember.id, 'nothing')
  // defMember: no prefs row → default behavior
  // mutedAllMember: level='all' AND muted=true → mute must win
  await ctx.pool.query(
    `INSERT INTO aaelink.channel_notification_prefs (user_id, channel_id, level, muted, updated_at)
     VALUES ($1, $2, 'all', true, $3) ON CONFLICT (user_id, channel_id) DO UPDATE SET level='all', muted=true`,
    [mutedAllMember.id, channel.id, Date.now()]
  )
  // kwAllMember: level='all' AND a keyword → must get exactly ONE alert
  await setLevel(kwAllMember.id, 'all')
  await ctx.pool.query(
    `INSERT INTO aaelink.notification_keywords (user_id, keyword, created_at)
     VALUES ($1, 'urgent', $2) ON CONFLICT DO NOTHING`,
    [kwAllMember.id, Date.now()]
  )
})

afterAll(async () => {
  await ctx.pool.query(`DELETE FROM aaelink.notification_keywords WHERE user_id = ANY($1)`, [createdIds])
  await ctx.pool.query(`DELETE FROM aaelink.channel_notification_prefs WHERE user_id = ANY($1)`, [createdIds])
  await ctx.pool.query(`DELETE FROM aaelink.notifications WHERE user_id = ANY($1)`, [createdIds])
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('channel notification level', () => {
  it("level 'all' is notified on a plain (no-mention) message; others are not", async () => {
    const id = await post('just a normal channel message')
    expect(await kinds(allMember.id, id)).toContain('channel_message')
    expect(await kinds(nothingMember.id, id)).toHaveLength(0)
    expect(await kinds(defMember.id, id)).toHaveLength(0)
  })

  it("level 'nothing' suppresses even an @mention", async () => {
    const id = await post(`hey @${usernameOf(nothingMember)} look`)
    expect(await kinds(nothingMember.id, id)).toHaveLength(0)
  })

  it('default level still gets @mention notifications', async () => {
    const id = await post(`hey @${usernameOf(defMember)} look`)
    expect(await kinds(defMember.id, id)).toContain('mention')
  })

  it("channel mute wins over level='all' (no in-app row for a muted member)", async () => {
    const id = await post('another plain message')
    expect(await kinds(mutedAllMember.id, id)).toHaveLength(0)
  })

  it("a level='all' + keyword member gets exactly ONE alert, not two", async () => {
    const id = await post('this is urgent everyone')
    // keyword path claims the user; level-all excludes them → single notification.
    expect(await kinds(kwAllMember.id, id)).toHaveLength(1)
  })
})
