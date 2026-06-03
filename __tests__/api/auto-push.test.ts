/**
 * Integration test for auto-push on @mention and DM.
 *
 * Posting a message that @mentions a user — or any message in a DM/group-DM —
 * must enqueue a `push_deliver` job for each recipient (lib/notifications/
 * pushTargeting.ts), unless the recipient muted the channel or is in DND.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, createTestChannel, asRequest,
  expectSuccess, cleanupTestData,
  TestContext, TestUser,
} from '../helpers'

let ctx: TestContext
let author: TestUser
let recipient: TestUser
let wsId: string
const createdIds: string[] = []

/** username createTestUser assigns: `test_<first 8 of id>`. */
const usernameOf = (u: TestUser) => `test_${u.id.slice(0, 8)}`

async function addChannelMember(channelId: string, userId: string) {
  await ctx.pool.query(
    `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
     VALUES ($1, $2, 'member', $3) ON CONFLICT DO NOTHING`,
    [channelId, userId, Date.now()]
  )
}

/** push_deliver jobs whose payload targets `userId` on `channelId`. */
async function pushJobsFor(userId: string, channelId: string): Promise<number> {
  const { rows } = await ctx.pool.query<{ payload: string }>(
    `SELECT payload FROM aaelink.jobs WHERE type = 'push_deliver' AND created_by = $1`,
    [author.id]
  )
  return rows.filter(r => {
    try {
      const p = JSON.parse(r.payload) as { user_id?: string; channel_id?: string }
      return p.user_id === userId && p.channel_id === channelId
    } catch { return false }
  }).length
}

async function postMessage(cookie: string, channelId: string, message: string) {
  const { POST } = await import('@/app/api/messages/route')
  return POST(asRequest('POST', '/api/messages', { cookie, body: { channel_id: channelId, message } }))
}

beforeAll(async () => {
  ctx = await createTestContext()
  author = await createTestUser(ctx.pool, { role: 'employee' })
  recipient = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(author.id, recipient.id)
  // Pin channels to the workspace the test users actually belong to — two
  // workspaces share created_at=1, so createTestChannel's "oldest" lookup is
  // non-deterministic and may land in a workspace the users aren't members of,
  // which would silently break mention resolution.
  const { rows: [m] } = await ctx.pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.workspace_members WHERE user_id = $1 LIMIT 1`,
    [author.id]
  )
  wsId = m.workspace_id
})

afterAll(async () => {
  await ctx.pool.query(`DELETE FROM aaelink.jobs WHERE created_by = ANY($1)`, [createdIds])
  await ctx.pool.query(`DELETE FROM aaelink.push_log WHERE user_id = ANY($1)`, [createdIds])
  await ctx.pool.query(`DELETE FROM aaelink.notifications WHERE user_id = ANY($1)`, [createdIds])
  await ctx.pool.query(`DELETE FROM aaelink.channel_mutes WHERE user_id = ANY($1)`, [createdIds])
  await ctx.pool.query(`DELETE FROM aaelink.dnd_settings WHERE user_id = ANY($1)`, [createdIds])
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('auto-push on @mention', () => {
  it('enqueues a push_deliver job for a mentioned channel member', async () => {
    const channel = await createTestChannel(ctx.pool, author.id, { workspaceId: wsId })
    await addChannelMember(channel.id, recipient.id)

    const res = await postMessage(author.sessionCookie, channel.id, `hey @${usernameOf(recipient)} look`)
    await expectSuccess(res)

    expect(await pushJobsFor(recipient.id, channel.id)).toBe(1)
    // and an in-app mention notification exists
    const { rows } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.notifications WHERE user_id = $1 AND channel_id = $2 AND kind = 'mention'`,
      [recipient.id, channel.id]
    )
    expect(rows.length).toBe(1)
  })

  it('does NOT push when the recipient muted the channel', async () => {
    const channel = await createTestChannel(ctx.pool, author.id, { workspaceId: wsId })
    await addChannelMember(channel.id, recipient.id)
    await ctx.pool.query(
      `INSERT INTO aaelink.channel_mutes (user_id, channel_id, created_at) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [recipient.id, channel.id, Date.now()]
    )

    const res = await postMessage(author.sessionCookie, channel.id, `ping @${usernameOf(recipient)}`)
    await expectSuccess(res)

    expect(await pushJobsFor(recipient.id, channel.id)).toBe(0)
  })

  it('does NOT push when the recipient is snoozed (DND)', async () => {
    const channel = await createTestChannel(ctx.pool, author.id, { workspaceId: wsId })
    await addChannelMember(channel.id, recipient.id)
    await ctx.pool.query(
      `INSERT INTO aaelink.dnd_settings (user_id, enabled, start_time, end_time, timezone, snooze_until, updated_at)
       VALUES ($1, false, '22:00', '08:00', 'UTC', $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET snooze_until = EXCLUDED.snooze_until`,
      [recipient.id, Date.now() + 3_600_000, Date.now()]
    )

    const res = await postMessage(author.sessionCookie, channel.id, `urgent @${usernameOf(recipient)}`)
    await expectSuccess(res)

    expect(await pushJobsFor(recipient.id, channel.id)).toBe(0)

    // clear snooze so later DM test (same recipient) isn't suppressed
    await ctx.pool.query(`UPDATE aaelink.dnd_settings SET snooze_until = 0 WHERE user_id = $1`, [recipient.id])
  })
})

describe('auto-push on DM', () => {
  it('enqueues a push + dm notification for every recipient', async () => {
    // Group-DM channel (type 'G', membership-gated) in the test users'
    // workspace, both as members. Exercises the same notifyDirectMessage branch.
    const dmId = randomUUID()
    const now = Date.now()
    await ctx.pool.query(
      `INSERT INTO aaelink.channels (id, workspace_id, name, display_name, type, created_by, created_at)
       VALUES ($1, $2, $3, $3, 'G', $4, $5)`,
      [dmId, wsId, `dm-${dmId.slice(0, 8)}`, author.id, now]
    )
    await addChannelMember(dmId, author.id)
    await addChannelMember(dmId, recipient.id)

    const res = await postMessage(author.sessionCookie, dmId, 'hello there, no mention needed')
    await expectSuccess(res)

    expect(await pushJobsFor(recipient.id, dmId)).toBe(1)
    const { rows } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.notifications WHERE user_id = $1 AND channel_id = $2 AND kind = 'dm'`,
      [recipient.id, dmId]
    )
    expect(rows.length).toBe(1)
  })
})
