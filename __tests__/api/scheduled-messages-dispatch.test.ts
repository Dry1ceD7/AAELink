/**
 * Integration tests for scheduled messages security gaps.
 *
 * (a) dispatch endpoint must require authentication:
 *     - unauthenticated POST → 401
 *     - authenticated non-admin → 403
 *     - valid DISPATCH_SECRET header → 200 (no session needed)
 *     - platform_admin session → 200
 *
 * (b) POST /api/scheduled-messages must enforce CSRF + channel RBAC:
 *     - POST without CSRF → 403
 *     - POST to archived channel → 403
 *
 * (c) dispatched message produces a mention notification.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext,
  createTestUser,
  createTestChannel,
  asRequest,
  cleanupTestData,
  TestContext,
  TestUser,
  TestChannel,
} from '../helpers'

import { POST as dispatchPOST } from '@/app/api/scheduled-messages/dispatch/route'
import { POST as scheduledPOST } from '@/app/api/scheduled-messages/route'
import { deliverScheduledMessage } from '@/lib/messaging/deliverScheduledMessage'
import { getPubSub, channelTopic } from '@/lib/realtime/redisPubSub'
import type { PubSubEvent } from '@/lib/realtime/redisPubSub'

let ctx: TestContext
let admin: TestUser
let employee: TestUser
let mentionTarget: TestUser
let channel: TestChannel
const createdIds: string[] = []

// ── helpers ──────────────────────────────────────────────────────────

async function insertScheduledMessage(
  userId: string,
  channelId: string,
  body: string,
  sendAtOffset = -1000 /* already due */
): Promise<string> {
  const id = randomUUID()
  const now = Date.now()
  await ctx.pool.query(
    `INSERT INTO aaelink.scheduled_messages
       (id, channel_id, user_id, body, root_id, send_at, status, created_at)
     VALUES ($1, $2, $3, $4, '', $5, 'pending', $6)`,
    [id, channelId, userId, body, now + sendAtOffset, now]
  )
  return id
}

async function getNotificationsForMessage(messageId: string) {
  const { rows } = await ctx.pool.query<{ user_id: string; kind: string }>(
    `SELECT user_id, kind FROM aaelink.notifications WHERE message_id = $1`,
    [messageId]
  )
  return rows
}

async function findInsertedMessageId(channelId: string, body: string): Promise<string | null> {
  const { rows } = await ctx.pool.query<{ id: string }>(
    `SELECT id FROM aaelink.messages WHERE channel_id = $1 AND body = $2 ORDER BY created_at DESC LIMIT 1`,
    [channelId, body]
  )
  return rows[0]?.id ?? null
}

// ── lifecycle ─────────────────────────────────────────────────────────

beforeAll(async () => {
  ctx = await createTestContext()
  admin = await createTestUser(ctx.pool, { role: 'platform_admin' })
  employee = await createTestUser(ctx.pool, { role: 'employee' })
  mentionTarget = await createTestUser(ctx.pool, { role: 'employee' })
  channel = await createTestChannel(ctx.pool, admin.id)

  createdIds.push(admin.id, employee.id, mentionTarget.id)

  // Add employee and mentionTarget as channel members so they can send/receive.
  const now = Date.now()
  await ctx.pool.query(
    `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
     VALUES ($1, $2, 'member', $3), ($1, $4, 'member', $3) ON CONFLICT DO NOTHING`,
    [channel.id, employee.id, now, mentionTarget.id]
  )
  // Ensure mentionTarget is in the same workspace as the channel.
  const { rows: [ws] } = await ctx.pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.channels WHERE id = $1`, [channel.id]
  )
  if (ws?.workspace_id) {
    await ctx.pool.query(
      `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
      [ws.workspace_id, mentionTarget.id]
    )
    await ctx.pool.query(
      `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
      [ws.workspace_id, employee.id]
    )
  }
})

afterAll(async () => {
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

// ── (a) dispatch authentication ───────────────────────────────────────

describe('POST /api/scheduled-messages/dispatch — auth guard', () => {
  it('returns 401 when unauthenticated (no session, no secret)', async () => {
    const req = asRequest('POST', '/api/scheduled-messages/dispatch', { noAutoCsrf: true })
    const res = await dispatchPOST(req)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('unauthorized')
  })

  it('returns 403 when authenticated as non-admin employee', async () => {
    const req = asRequest('POST', '/api/scheduled-messages/dispatch', {
      cookie: employee.sessionCookie,
    })
    const res = await dispatchPOST(req)
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toBe('forbidden')
  })

  it('returns 200 when called with valid DISPATCH_SECRET header', async () => {
    const secret = 'test-dispatch-secret-' + randomUUID()
    process.env.DISPATCH_SECRET = secret
    try {
      const req = asRequest('POST', '/api/scheduled-messages/dispatch', {
        noAutoCsrf: true,
        headers: { 'x-dispatch-secret': secret },
      })
      const res = await dispatchPOST(req)
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(typeof json.dispatched).toBe('number')
    } finally {
      delete process.env.DISPATCH_SECRET
    }
  })

  it('returns 200 when called with a platform_admin session', async () => {
    const req = asRequest('POST', '/api/scheduled-messages/dispatch', {
      cookie: admin.sessionCookie,
    })
    const res = await dispatchPOST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(typeof json.dispatched).toBe('number')
  })
})

// ── (c) dispatched message produces mention notification ──────────────

describe('POST /api/scheduled-messages/dispatch — mention notification', () => {
  it('fan-out: dispatched message containing @mention creates a notification', async () => {
    // mentionTarget's username is used in the @mention body.
    const { rows: [uRow] } = await ctx.pool.query<{ username: string }>(
      `SELECT username FROM aaelink.users WHERE id = $1`, [mentionTarget.id]
    )
    const mentionBody = `Hey @${uRow.username} check this out`

    // Insert a due scheduled message from the employee.
    await insertScheduledMessage(employee.id, channel.id, mentionBody)

    // Dispatch via admin session.
    const req = asRequest('POST', '/api/scheduled-messages/dispatch', {
      cookie: admin.sessionCookie,
    })
    const res = await dispatchPOST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.dispatched).toBeGreaterThanOrEqual(1)

    // The inserted message row should exist.
    const msgId = await findInsertedMessageId(channel.id, mentionBody)
    expect(msgId).not.toBeNull()

    // The mention target should have received a notification.
    const notifs = await getNotificationsForMessage(msgId!)
    const mentionNotif = notifs.find(n => n.user_id === mentionTarget.id && n.kind === 'mention')
    expect(mentionNotif).toBeDefined()
  })
})

// ── (d) PROCESSOR path: deliverScheduledMessage produces notif + pub/sub emit ──
//
// The in-process scheduledMessageProcessor (primary production sender) does NOT
// go through the HTTP dispatch route — it calls deliverScheduledMessage directly.
// This test drives that shared helper directly to prove the processor path
// produces BOTH a notification row AND a realtime pub/sub emit (Hard Rule #6).

describe('deliverScheduledMessage — processor path notifications + realtime emit', () => {
  it('inserts the message, emits a message pub/sub event, and notifies the @mention target', async () => {
    const { rows: [chRow] } = await ctx.pool.query<{ workspace_id: string }>(
      `SELECT workspace_id FROM aaelink.channels WHERE id = $1`, [channel.id]
    )
    expect(chRow?.workspace_id).toBeTruthy()
    const { rows: [uRow] } = await ctx.pool.query<{ username: string }>(
      `SELECT username FROM aaelink.users WHERE id = $1`, [mentionTarget.id]
    )
    const body = `processor path @${uRow.username} ${randomUUID()}`

    // Subscribe to the channel topic on the same in-memory PubSub the helper uses.
    const events: PubSubEvent[] = []
    const unsubscribe = getPubSub().subscribe(channelTopic(channel.id), (e) => { events.push(e) })

    let messageId: string
    try {
      // Drive the shared helper directly — exactly what the processor loop does.
      messageId = await deliverScheduledMessage(ctx.pool, {
        channelId: channel.id,
        userId: employee.id,
        body,
        rootId: '',
        createdAt: Date.now(),
      })
    } finally {
      unsubscribe()
    }

    // (1) Message row was inserted.
    const insertedId = await findInsertedMessageId(channel.id, body)
    expect(insertedId).toBe(messageId)

    // (2) Realtime pub/sub emit happened for this channel (Hard Rule #6).
    const messageEvents = events.filter(e => e.type === 'message')
    expect(messageEvents.length).toBeGreaterThanOrEqual(1)
    const emitted = messageEvents.find(
      e => 'payload' in e && (e.payload as { id?: string }).id === messageId
    )
    expect(emitted).toBeDefined()
    expect((emitted as { channel_id: string }).channel_id).toBe(channel.id)

    // (3) The @mention target received a mention notification.
    const notifs = await getNotificationsForMessage(messageId)
    const mentionNotif = notifs.find(n => n.user_id === mentionTarget.id && n.kind === 'mention')
    expect(mentionNotif).toBeDefined()
  })
})

// ── (b) POST /api/scheduled-messages — CSRF + channel RBAC ───────────

describe('POST /api/scheduled-messages — CSRF + RBAC', () => {
  it('returns 403 when CSRF token is missing (authenticated session)', async () => {
    const futureTs = Date.now() + 60_000
    const req = asRequest('POST', '/api/scheduled-messages', {
      cookie: employee.sessionCookie,
      body: { channel_id: channel.id, body: 'test msg', send_at: futureTs },
      noAutoCsrf: true,
    })
    const res = await scheduledPOST(req)
    // verifyCsrf returns 403 for authenticated sessions with missing/invalid token.
    // (It returns null when there is no session, so a missing session gives 401.)
    expect([403]).toContain(res.status)
  })

  it('returns 403 when posting to an archived channel', async () => {
    // Create and archive a separate channel.
    const archivedCh = await createTestChannel(ctx.pool, admin.id)
    await ctx.pool.query(
      `UPDATE aaelink.channels SET archived_at = 1 WHERE id = $1`, [archivedCh.id]
    )

    const futureTs = Date.now() + 60_000
    const req = asRequest('POST', '/api/scheduled-messages', {
      cookie: employee.sessionCookie,
      body: { channel_id: archivedCh.id, body: 'test', send_at: futureTs },
    })
    const res = await scheduledPOST(req)
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toBe('channel_archived')
  })
})
