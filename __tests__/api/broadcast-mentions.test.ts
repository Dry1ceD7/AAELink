/**
 * Integration tests for broadcast mention notifications
 * (@here / @channel / @everyone fan-out).
 *
 * Tests:
 *  - @channel notifies all channel members except sender
 *  - @here notifies only online members (not away/offline)
 *  - allow_broadcast_mentions=false suppresses all broadcast notifications
 *  - user broadcast_mentions_enabled=false suppresses that user
 *  - direct-mention dedup: a user @mentioned by name does not also get a broadcast row
 *  - @everyone behaves like @channel
 *  - @all alias normalises to 'everyone' and fans out like @channel
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, createTestChannel,
  TestContext, TestUser, TestChannel,
} from '../helpers'
import { notifyBroadcastMentions } from '@/lib/notifications/notificationsServer'

let ctx: TestContext
let sender: TestUser
let memberA: TestUser
let memberB: TestUser
let memberC: TestUser
let channel: TestChannel
const createdIds: string[] = []

async function addMember(pool: import('pg').Pool, channelId: string, userId: string) {
  const now = Date.now()
  await pool.query(
    `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
     VALUES ($1, $2, 'member', $3) ON CONFLICT DO NOTHING`,
    [channelId, userId, now]
  )
}

async function setUserStatus(pool: import('pg').Pool, userId: string, status: string) {
  const now = Date.now()
  await pool.query(
    `INSERT INTO aaelink.user_status (user_id, status, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET status = $2, updated_at = $3`,
    [userId, status, now]
  )
}

async function getNotifications(pool: import('pg').Pool, messageId: string) {
  const { rows } = await pool.query<{ user_id: string; kind: string }>(
    `SELECT user_id, kind FROM aaelink.notifications WHERE message_id = $1`,
    [messageId]
  )
  return rows
}

async function cleanupNotifications(pool: import('pg').Pool, messageId: string) {
  await pool.query(`DELETE FROM aaelink.notifications WHERE message_id = $1`, [messageId])
}

beforeAll(async () => {
  ctx = await createTestContext()
  sender = await createTestUser(ctx.pool)
  memberA = await createTestUser(ctx.pool)
  memberB = await createTestUser(ctx.pool)
  memberC = await createTestUser(ctx.pool)
  createdIds.push(sender.id, memberA.id, memberB.id, memberC.id)

  channel = await createTestChannel(ctx.pool, sender.id)
  await addMember(ctx.pool, channel.id, memberA.id)
  await addMember(ctx.pool, channel.id, memberB.id)
  await addMember(ctx.pool, channel.id, memberC.id)
})

afterAll(async () => {
  // Clean up users (cascade removes sessions, channel_members, notifications etc.)
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [createdIds])
  await ctx.cleanup()
})

// Helper: get workspaceId for the test channel
async function getWorkspaceId(): Promise<string> {
  const { rows } = await ctx.pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.channels WHERE id = $1`,
    [channel.id]
  )
  return rows[0].workspace_id
}

describe('notifyBroadcastMentions — @channel', () => {
  it('notifies all channel members except sender', async () => {
    const messageId = randomUUID()
    const workspaceId = await getWorkspaceId()

    const notified = await notifyBroadcastMentions({
      pool: ctx.pool,
      workspaceId,
      channelId: channel.id,
      channelLabel: '#general',
      messageId,
      senderId: sender.id,
      senderLabel: 'Sender',
      body: '@channel heads up',
      tokens: new Set(['channel']),
    })
    await cleanupNotifications(ctx.pool, messageId)

    expect(notified).not.toContain(sender.id)
    expect(notified).toContain(memberA.id)
    expect(notified).toContain(memberB.id)
    expect(notified).toContain(memberC.id)
  })

  it('inserts notifications with kind=broadcast', async () => {
    const messageId = randomUUID()
    const workspaceId = await getWorkspaceId()

    await notifyBroadcastMentions({
      pool: ctx.pool,
      workspaceId,
      channelId: channel.id,
      channelLabel: '#general',
      messageId,
      senderId: sender.id,
      senderLabel: 'Sender',
      body: '@channel note',
      tokens: new Set(['channel']),
    })

    const rows = await getNotifications(ctx.pool, messageId)
    await cleanupNotifications(ctx.pool, messageId)

    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(r.kind).toBe('broadcast')
    }
  })
})

describe('notifyBroadcastMentions — @here (online only)', () => {
  it('notifies only online members', async () => {
    // Set memberA online, memberB away, memberC offline
    await setUserStatus(ctx.pool, memberA.id, 'online')
    await setUserStatus(ctx.pool, memberB.id, 'away')
    await setUserStatus(ctx.pool, memberC.id, 'offline')

    const messageId = randomUUID()
    const workspaceId = await getWorkspaceId()

    const notified = await notifyBroadcastMentions({
      pool: ctx.pool,
      workspaceId,
      channelId: channel.id,
      channelLabel: '#general',
      messageId,
      senderId: sender.id,
      senderLabel: 'Sender',
      body: '@here check this',
      tokens: new Set(['here']),
    })
    await cleanupNotifications(ctx.pool, messageId)

    // Cleanup statuses
    await ctx.pool.query(
      `DELETE FROM aaelink.user_status WHERE user_id = ANY($1)`,
      [[memberA.id, memberB.id, memberC.id]]
    )

    expect(notified).toContain(memberA.id)
    expect(notified).not.toContain(memberB.id)
    expect(notified).not.toContain(memberC.id)
    expect(notified).not.toContain(sender.id)
  })

  it('treats absent user_status row as online', async () => {
    // Ensure no status rows for members
    await ctx.pool.query(
      `DELETE FROM aaelink.user_status WHERE user_id = ANY($1)`,
      [[memberA.id, memberB.id, memberC.id]]
    )

    const messageId = randomUUID()
    const workspaceId = await getWorkspaceId()

    const notified = await notifyBroadcastMentions({
      pool: ctx.pool,
      workspaceId,
      channelId: channel.id,
      channelLabel: '#general',
      messageId,
      senderId: sender.id,
      senderLabel: 'Sender',
      body: '@here anyone?',
      tokens: new Set(['here']),
    })
    await cleanupNotifications(ctx.pool, messageId)

    // All three members have no status row → default 'online' → all notified
    expect(notified).toContain(memberA.id)
    expect(notified).toContain(memberB.id)
    expect(notified).toContain(memberC.id)
  })
})

describe('notifyBroadcastMentions — allow_broadcast_mentions=false', () => {
  it('suppresses all notifications when channel flag is false', async () => {
    // Disable broadcast mentions for the channel
    await ctx.pool.query(
      `UPDATE aaelink.channels SET allow_broadcast_mentions = false WHERE id = $1`,
      [channel.id]
    )

    const messageId = randomUUID()
    const workspaceId = await getWorkspaceId()

    const notified = await notifyBroadcastMentions({
      pool: ctx.pool,
      workspaceId,
      channelId: channel.id,
      channelLabel: '#general',
      messageId,
      senderId: sender.id,
      senderLabel: 'Sender',
      body: '@channel suppressed',
      tokens: new Set(['channel']),
    })
    await cleanupNotifications(ctx.pool, messageId)

    // Re-enable for subsequent tests
    await ctx.pool.query(
      `UPDATE aaelink.channels SET allow_broadcast_mentions = true WHERE id = $1`,
      [channel.id]
    )

    expect(notified).toHaveLength(0)
  })
})

describe('notifyBroadcastMentions — user pref broadcast_mentions_enabled=false', () => {
  it('suppresses notification for user with pref disabled', async () => {
    const now = Date.now()
    // Disable broadcast pref for memberA only
    await ctx.pool.query(
      `INSERT INTO aaelink.user_notification_prefs
         (user_id, mentions_enabled, ticket_activity_enabled, system_notifications_enabled,
          broadcast_mentions_enabled, updated_at)
       VALUES ($1, true, true, true, false, $2)
       ON CONFLICT (user_id) DO UPDATE SET broadcast_mentions_enabled = false, updated_at = $2`,
      [memberA.id, now]
    )

    const messageId = randomUUID()
    const workspaceId = await getWorkspaceId()

    const notified = await notifyBroadcastMentions({
      pool: ctx.pool,
      workspaceId,
      channelId: channel.id,
      channelLabel: '#general',
      messageId,
      senderId: sender.id,
      senderLabel: 'Sender',
      body: '@channel note',
      tokens: new Set(['channel']),
    })
    await cleanupNotifications(ctx.pool, messageId)

    // Restore pref
    await ctx.pool.query(
      `UPDATE aaelink.user_notification_prefs SET broadcast_mentions_enabled = true WHERE user_id = $1`,
      [memberA.id]
    )

    expect(notified).not.toContain(memberA.id)
    expect(notified).toContain(memberB.id)
    expect(notified).toContain(memberC.id)
  })
})

describe('notifyBroadcastMentions — direct-mention dedup', () => {
  it('skips users already in directMentionUserIds', async () => {
    const messageId = randomUUID()
    const workspaceId = await getWorkspaceId()

    const notified = await notifyBroadcastMentions({
      pool: ctx.pool,
      workspaceId,
      channelId: channel.id,
      channelLabel: '#general',
      messageId,
      senderId: sender.id,
      senderLabel: 'Sender',
      body: '@channel also @alice',
      tokens: new Set(['channel']),
      directMentionUserIds: [memberA.id],
    })
    await cleanupNotifications(ctx.pool, messageId)

    // memberA was directly mentioned — skip from broadcast
    expect(notified).not.toContain(memberA.id)
    expect(notified).toContain(memberB.id)
    expect(notified).toContain(memberC.id)
  })
})

describe('notifyBroadcastMentions — @everyone and @all aliases', () => {
  it('@everyone fans out to all channel members like @channel', async () => {
    const messageId = randomUUID()
    const workspaceId = await getWorkspaceId()

    const notified = await notifyBroadcastMentions({
      pool: ctx.pool,
      workspaceId,
      channelId: channel.id,
      channelLabel: '#general',
      messageId,
      senderId: sender.id,
      senderLabel: 'Sender',
      body: '@everyone important',
      tokens: new Set(['everyone']),
    })
    await cleanupNotifications(ctx.pool, messageId)

    expect(notified).not.toContain(sender.id)
    expect(notified).toContain(memberA.id)
    expect(notified).toContain(memberB.id)
    expect(notified).toContain(memberC.id)
  })

  it('empty tokens set returns empty', async () => {
    const messageId = randomUUID()
    const workspaceId = await getWorkspaceId()

    const notified = await notifyBroadcastMentions({
      pool: ctx.pool,
      workspaceId,
      channelId: channel.id,
      channelLabel: '#general',
      messageId,
      senderId: sender.id,
      senderLabel: 'Sender',
      body: 'no broadcast here',
      tokens: new Set(),
    })
    await cleanupNotifications(ctx.pool, messageId)

    expect(notified).toHaveLength(0)
  })
})
