/**
 * Integration tests for /api/threads route and thread-follower notification wiring.
 *
 * Tests:
 *   - GET /api/threads — list threaded conversations
 *   - Auth guard (401 without session)
 *   - is_following reflects thread_followers table (follow → true, unfollow → false)
 *   - Posting a reply auto-follows the replier
 *   - Reply notifies existing follower (not the replier)
 *   - Unfollow stops receiving notifications on subsequent reply
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, asRequest,
  expectSuccess, cleanupTestData,
  TestContext, TestUser, createTestChannel
} from '../helpers'

let ctx: TestContext
let admin: TestUser
let follower: TestUser
let replier: TestUser
const createdIds: string[] = []

beforeAll(async () => {
  ctx = await createTestContext()
  admin = await createTestUser(ctx.pool, { role: 'super_admin' })
  follower = await createTestUser(ctx.pool, { role: 'employee' })
  replier = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(admin.id, follower.id, replier.id)
})

afterAll(async () => {
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('GET /api/threads', () => {
  it('returns 401 without session', async () => {
    const { GET } = await import('@/app/api/threads/route')
    const req = asRequest('GET', '/api/threads')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns threads list for authenticated user', async () => {
    const { GET } = await import('@/app/api/threads/route')
    const { rows: [ws] } = await ctx.pool.query(`SELECT id FROM aaelink.workspaces ORDER BY created_at LIMIT 1`)
    if (!ws) return

    const req = asRequest('GET', '/api/threads', {
      cookie: admin.sessionCookie,
      query: { workspace_id: ws.id }
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await expectSuccess<{ threads: unknown[] }>(res)
    expect(Array.isArray(body.threads)).toBe(true)
  })
})

describe('thread_followers: is_following reflects the table', () => {
  it('is_following is false before following', async () => {
    const { GET } = await import('@/app/api/threads/route')
    const ch = await createTestChannel(ctx.pool, admin.id)
    const { rows: [ws] } = await ctx.pool.query(`SELECT id FROM aaelink.workspaces ORDER BY created_at LIMIT 1`)
    if (!ws) return

    // Insert a root message and a reply so the thread appears in the list.
    const threadId = randomUUID()
    const now = Date.now()
    await ctx.pool.query(
      `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'root', '', $4, $4)`,
      [threadId, ch.id, admin.id, now]
    )
    await ctx.pool.query(
      `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'reply1', $4, $5, $5)`,
      [randomUUID(), ch.id, replier.id, threadId, now + 1]
    )
    // follower has not yet followed the thread
    const req = asRequest('GET', '/api/threads', {
      cookie: follower.sessionCookie,
      query: { workspace_id: ws.id }
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await expectSuccess<{ threads: { id: string; is_following: boolean }[] }>(res)
    const thread = body.threads.find(t => t.id === threadId)
    expect(thread).toBeDefined()
    expect(thread!.is_following).toBe(false)
  })

  it('is_following is true after explicit follow via thread_followers insert', async () => {
    const { GET } = await import('@/app/api/threads/route')
    const ch = await createTestChannel(ctx.pool, admin.id)
    const { rows: [ws] } = await ctx.pool.query(`SELECT id FROM aaelink.workspaces ORDER BY created_at LIMIT 1`)
    if (!ws) return

    const threadId = randomUUID()
    const now = Date.now()
    await ctx.pool.query(
      `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'root', '', $4, $4)`,
      [threadId, ch.id, admin.id, now]
    )
    await ctx.pool.query(
      `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'reply', $4, $5, $5)`,
      [randomUUID(), ch.id, replier.id, threadId, now + 1]
    )
    // Explicitly follow the thread
    await ctx.pool.query(
      `INSERT INTO aaelink.thread_followers (thread_id, user_id, created_at)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [threadId, follower.id, now]
    )

    const req = asRequest('GET', '/api/threads', {
      cookie: follower.sessionCookie,
      query: { workspace_id: ws.id }
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await expectSuccess<{ threads: { id: string; is_following: boolean }[] }>(res)
    const thread = body.threads.find(t => t.id === threadId)
    expect(thread).toBeDefined()
    expect(thread!.is_following).toBe(true)
  })

  it('thread originator follows their own thread (root author, no reply, no thread_followers row)', async () => {
    const { GET, POST } = await import('@/app/api/threads/route')
    const ch = await createTestChannel(ctx.pool, admin.id)
    const { rows: [ws] } = await ctx.pool.query(`SELECT id FROM aaelink.workspaces ORDER BY created_at LIMIT 1`)
    if (!ws) return

    // admin authors the root; replier posts the single reply so the thread is listed.
    // admin never replies and has NO thread_followers row — they follow purely as originator.
    const threadId = randomUUID()
    const now = Date.now()
    await ctx.pool.query(
      `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'root', '', $4, $4)`,
      [threadId, ch.id, admin.id, now]
    )
    await ctx.pool.query(
      `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'reply', $4, $5, $5)`,
      [randomUUID(), ch.id, replier.id, threadId, now + 1]
    )
    // Guard: confirm the originator has no thread_followers row.
    const { rows: tfRows } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.thread_followers WHERE thread_id = $1 AND user_id = $2`,
      [threadId, admin.id]
    )
    expect(tfRows.length).toBe(0)

    // GET: the originator is reported as following their own thread.
    const getReq = asRequest('GET', '/api/threads', {
      cookie: admin.sessionCookie,
      query: { workspace_id: ws.id }
    })
    const getRes = await GET(getReq)
    expect(getRes.status).toBe(200)
    const getBody = await expectSuccess<{ threads: { id: string; is_following: boolean }[] }>(getRes)
    const thread = getBody.threads.find(t => t.id === threadId)
    expect(thread).toBeDefined()
    expect(thread!.is_following).toBe(true)

    // POST mark-read: the originator's channel is included in bulk mark-read.
    await ctx.pool.query(
      `DELETE FROM aaelink.channel_read_state WHERE channel_id = $1 AND user_id = $2`,
      [ch.id, admin.id]
    )
    const postReq = asRequest('POST', '/api/threads', {
      cookie: admin.sessionCookie,
      body: { workspace_id: ws.id }
    })
    const postRes = await POST(postReq)
    expect(postRes.status).toBe(200)
    const { rows: readRows } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.channel_read_state WHERE channel_id = $1 AND user_id = $2`,
      [ch.id, admin.id]
    )
    expect(readRows.length).toBe(1)
  })

  it('is_following reverts to false after unfollow (row deleted)', async () => {
    const { GET } = await import('@/app/api/threads/route')
    const ch = await createTestChannel(ctx.pool, admin.id)
    const { rows: [ws] } = await ctx.pool.query(`SELECT id FROM aaelink.workspaces ORDER BY created_at LIMIT 1`)
    if (!ws) return

    const threadId = randomUUID()
    const now = Date.now()
    await ctx.pool.query(
      `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'root', '', $4, $4)`,
      [threadId, ch.id, admin.id, now]
    )
    await ctx.pool.query(
      `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'reply', $4, $5, $5)`,
      [randomUUID(), ch.id, replier.id, threadId, now + 1]
    )
    // Follow then immediately unfollow
    await ctx.pool.query(
      `INSERT INTO aaelink.thread_followers (thread_id, user_id, created_at) VALUES ($1, $2, $3)`,
      [threadId, follower.id, now]
    )
    await ctx.pool.query(
      `DELETE FROM aaelink.thread_followers WHERE thread_id = $1 AND user_id = $2`,
      [threadId, follower.id]
    )

    const req = asRequest('GET', '/api/threads', {
      cookie: follower.sessionCookie,
      query: { workspace_id: ws.id }
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await expectSuccess<{ threads: { id: string; is_following: boolean }[] }>(res)
    const thread = body.threads.find(t => t.id === threadId)
    expect(thread).toBeDefined()
    expect(thread!.is_following).toBe(false)
  })
})

describe('thread reply notifications fan-out', () => {
  it('posting a reply auto-follows the replier', async () => {
    const { POST } = await import('@/app/api/messages/route')
    const ch = await createTestChannel(ctx.pool, admin.id)
    // Ensure replier is a channel member
    await ctx.pool.query(
      `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
       VALUES ($1, $2, 'member', $3) ON CONFLICT DO NOTHING`,
      [ch.id, replier.id, Date.now()]
    )

    const threadId = randomUUID()
    const now = Date.now()
    await ctx.pool.query(
      `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'root message', '', $4, $4)`,
      [threadId, ch.id, admin.id, now]
    )

    const req = asRequest('POST', '/api/messages', {
      cookie: replier.sessionCookie,
      body: { channel_id: ch.id, message: 'auto-follow reply', root_id: threadId }
    })
    const res = await POST(req)
    expect(res.status).toBe(200)

    const { rows } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.thread_followers WHERE thread_id = $1 AND user_id = $2`,
      [threadId, replier.id]
    )
    expect(rows.length).toBe(1)
  })

  it('reply notifies a follower but not the replier', async () => {
    const { POST } = await import('@/app/api/messages/route')
    const ch = await createTestChannel(ctx.pool, admin.id)
    // Ensure both users are channel members
    const memberNow = Date.now()
    for (const userId of [follower.id, replier.id]) {
      await ctx.pool.query(
        `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
         VALUES ($1, $2, 'member', $3) ON CONFLICT DO NOTHING`,
        [ch.id, userId, memberNow]
      )
    }

    const threadId = randomUUID()
    const now = Date.now()
    await ctx.pool.query(
      `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'root message', '', $4, $4)`,
      [threadId, ch.id, admin.id, now]
    )
    // follower explicitly follows the thread
    await ctx.pool.query(
      `INSERT INTO aaelink.thread_followers (thread_id, user_id, created_at)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [threadId, follower.id, now]
    )
    // Clean up any pre-existing notifications for these users in this channel
    await ctx.pool.query(
      `DELETE FROM aaelink.notifications
       WHERE channel_id = $1 AND user_id = ANY($2) AND kind = 'thread_reply'`,
      [ch.id, [follower.id, replier.id]]
    )

    const req = asRequest('POST', '/api/messages', {
      cookie: replier.sessionCookie,
      body: { channel_id: ch.id, message: 'follower notification test', root_id: threadId }
    })
    const res = await POST(req)
    expect(res.status).toBe(200)

    // follower should have received a thread_reply notification
    const { rows: followerRows } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.notifications
       WHERE channel_id = $1 AND user_id = $2 AND kind = 'thread_reply'`,
      [ch.id, follower.id]
    )
    expect(followerRows.length).toBeGreaterThan(0)

    // replier (the sender) should NOT receive a notification for their own reply
    const { rows: replierRows } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.notifications
       WHERE channel_id = $1 AND user_id = $2 AND kind = 'thread_reply'`,
      [ch.id, replier.id]
    )
    expect(replierRows.length).toBe(0)
  })

  it('mention wins over thread_reply: a followed + @mentioned user gets mention, not thread_reply', async () => {
    const { POST } = await import('@/app/api/messages/route')
    const ch = await createTestChannel(ctx.pool, admin.id)
    const memberNow = Date.now()
    for (const userId of [follower.id, replier.id]) {
      await ctx.pool.query(
        `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
         VALUES ($1, $2, 'member', $3) ON CONFLICT DO NOTHING`,
        [ch.id, userId, memberNow]
      )
    }

    // follower's username — used to build the @mention in the reply body.
    const { rows: [fRow] } = await ctx.pool.query<{ username: string }>(
      `SELECT username FROM aaelink.users WHERE id = $1`, [follower.id]
    )

    const threadId = randomUUID()
    const now = Date.now()
    await ctx.pool.query(
      `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'root message', '', $4, $4)`,
      [threadId, ch.id, admin.id, now]
    )
    // follower follows the thread AND will be @mentioned in the reply.
    await ctx.pool.query(
      `INSERT INTO aaelink.thread_followers (thread_id, user_id, created_at)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [threadId, follower.id, now]
    )
    // Clear any prior notifications for the follower in this channel.
    await ctx.pool.query(
      `DELETE FROM aaelink.notifications WHERE channel_id = $1 AND user_id = $2`,
      [ch.id, follower.id]
    )

    const req = asRequest('POST', '/api/messages', {
      cookie: replier.sessionCookie,
      body: { channel_id: ch.id, message: `hey @${fRow.username} look here`, root_id: threadId }
    })
    const res = await POST(req)
    expect(res.status).toBe(200)

    // The follower IS @mentioned → gets a 'mention' notification.
    const { rows: mentionRows } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.notifications
       WHERE channel_id = $1 AND user_id = $2 AND kind = 'mention'`,
      [ch.id, follower.id]
    )
    expect(mentionRows.length).toBeGreaterThan(0)

    // ...and must NOT also receive a duplicate 'thread_reply' (mention wins).
    const { rows: threadRows } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.notifications
       WHERE channel_id = $1 AND user_id = $2 AND kind = 'thread_reply'`,
      [ch.id, follower.id]
    )
    expect(threadRows.length).toBe(0)
  })

  it('follower who lost channel read access does not receive thread_reply (no leak)', async () => {
    const { POST } = await import('@/app/api/messages/route')
    // PRIVATE channel so read access requires an explicit channel_members row.
    const ch = await createTestChannel(ctx.pool, admin.id, { type: 'private' })
    const memberNow = Date.now()
    // replier must be a member to post; follower is intentionally NOT a member.
    await ctx.pool.query(
      `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
       VALUES ($1, $2, 'member', $3) ON CONFLICT DO NOTHING`,
      [ch.id, replier.id, memberNow]
    )

    const threadId = randomUUID()
    const now = Date.now()
    await ctx.pool.query(
      `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'root message', '', $4, $4)`,
      [threadId, ch.id, admin.id, now]
    )
    // follower still follows the thread but has since lost channel access.
    await ctx.pool.query(
      `INSERT INTO aaelink.thread_followers (thread_id, user_id, created_at)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [threadId, follower.id, now]
    )
    await ctx.pool.query(
      `DELETE FROM aaelink.notifications WHERE channel_id = $1 AND user_id = $2 AND kind = 'thread_reply'`,
      [ch.id, follower.id]
    )

    const req = asRequest('POST', '/api/messages', {
      cookie: replier.sessionCookie,
      body: { channel_id: ch.id, message: 'reply in private thread', root_id: threadId }
    })
    const res = await POST(req)
    expect(res.status).toBe(200)

    // follower lost read access → MUST NOT receive a thread_reply notification.
    const { rows } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.notifications
       WHERE channel_id = $1 AND user_id = $2 AND kind = 'thread_reply'`,
      [ch.id, follower.id]
    )
    expect(rows.length).toBe(0)
  })

  it('unfollow stops thread_reply notifications on subsequent reply', async () => {
    const { POST } = await import('@/app/api/messages/route')
    const ch = await createTestChannel(ctx.pool, admin.id)
    const memberNow = Date.now()
    for (const userId of [follower.id, replier.id]) {
      await ctx.pool.query(
        `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
         VALUES ($1, $2, 'member', $3) ON CONFLICT DO NOTHING`,
        [ch.id, userId, memberNow]
      )
    }

    const threadId = randomUUID()
    const now = Date.now()
    await ctx.pool.query(
      `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'root message', '', $4, $4)`,
      [threadId, ch.id, admin.id, now]
    )
    // follower follows, then immediately unfollows
    await ctx.pool.query(
      `INSERT INTO aaelink.thread_followers (thread_id, user_id, created_at)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [threadId, follower.id, now]
    )
    await ctx.pool.query(
      `DELETE FROM aaelink.thread_followers WHERE thread_id = $1 AND user_id = $2`,
      [threadId, follower.id]
    )
    // Remove any prior notifications
    await ctx.pool.query(
      `DELETE FROM aaelink.notifications
       WHERE channel_id = $1 AND user_id = $2 AND kind = 'thread_reply'`,
      [ch.id, follower.id]
    )

    const req = asRequest('POST', '/api/messages', {
      cookie: replier.sessionCookie,
      body: { channel_id: ch.id, message: 'post-unfollow reply', root_id: threadId }
    })
    const res = await POST(req)
    expect(res.status).toBe(200)

    // follower has unfollowed — no thread_reply notification
    const { rows } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.notifications
       WHERE channel_id = $1 AND user_id = $2 AND kind = 'thread_reply'`,
      [ch.id, follower.id]
    )
    expect(rows.length).toBe(0)
  })
})
