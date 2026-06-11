/**
 * Integration tests for /api/messages/[id] — PATCH (edit) and DELETE.
 *
 * Covers Hard Rule #5: every write that affects another user or compliance
 * scope must emit an actor-attributed audit log row via writeAuditLog.
 *
 * writeAuditLog is fire-and-forget (no await), so audit rows are polled
 * briefly after each operation — identical to the canvas.test.ts pattern.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, createTestChannel, asRequest,
  expectSuccess, cleanupTestData, TestContext, TestUser,
} from '../helpers'

let ctx: TestContext
let owner: TestUser
const userIds: string[] = []
const channelIds: string[] = []
const messageIds: string[] = []

async function importRoute() {
  return import('@/app/api/messages/[id]/route')
}

/** Poll the audit_log table until the row lands (fire-and-forget timing). */
async function pollAuditRow(action: string, resourceId: string, timeoutMs = 500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { rows } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.audit_log WHERE action = $1 AND resource_id = $2`,
      [action, resourceId]
    )
    if (rows.length > 0) return true
    await new Promise((r) => setTimeout(r, 25))
  }
  return false
}

beforeAll(async () => {
  ctx = await createTestContext()
  owner = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(owner.id)
})

afterAll(async () => {
  if (messageIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.message_edits WHERE message_id = ANY($1)`, [messageIds])
    await ctx.pool.query(`DELETE FROM aaelink.message_deletions WHERE message_id = ANY($1)`, [messageIds]).catch(() => {})
    await ctx.pool.query(`DELETE FROM aaelink.messages WHERE id = ANY($1)`, [messageIds]).catch(() => {})
  }
  if (channelIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.channel_members WHERE channel_id = ANY($1)`, [channelIds]).catch(() => {})
    await ctx.pool.query(`DELETE FROM aaelink.channels WHERE id = ANY($1)`, [channelIds]).catch(() => {})
  }
  await ctx.pool.query(
    `DELETE FROM aaelink.audit_log WHERE actor_id = $1 AND action IN ('message.edit','message.delete')`,
    [owner.id]
  ).catch(() => {})
  await cleanupTestData(ctx.pool, userIds)
  await ctx.cleanup()
})

async function createChannelAndMessage(body = 'hello world'): Promise<{ channelId: string; messageId: string }> {
  const channel = await createTestChannel(ctx.pool, owner.id)
  channelIds.push(channel.id)

  const messageId = randomUUID()
  const now = Date.now()
  await ctx.pool.query(
    `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '', $5, $5)`,
    [messageId, channel.id, owner.id, body, now]
  )
  messageIds.push(messageId)
  return { channelId: channel.id, messageId }
}

describe('PATCH /api/messages/[id] — audit log', () => {
  it('writes a message.edit audit row with actorId and channel_id metadata', async () => {
    const { PATCH } = await importRoute()
    const { channelId, messageId } = await createChannelAndMessage()

    const res = await PATCH(
      asRequest('PATCH', `/api/messages/${messageId}`, {
        cookie: owner.sessionCookie,
        body: { message: 'edited content' },
      }),
      { params: Promise.resolve({ id: messageId }) }
    )
    expect(res.status).toBe(200)

    const found = await pollAuditRow('message.edit', messageId)
    expect(found).toBe(true)

    const { rows } = await ctx.pool.query(
      `SELECT actor_id, resource_kind, metadata FROM aaelink.audit_log
       WHERE action = 'message.edit' AND resource_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [messageId]
    )
    expect(rows[0].actor_id).toBe(owner.id)
    expect(rows[0].resource_kind).toBe('message')
    const meta = typeof rows[0].metadata === 'string' ? JSON.parse(rows[0].metadata) : rows[0].metadata
    expect(meta.channel_id).toBe(channelId)
  })

  it('returns 401 without session', async () => {
    const { PATCH } = await importRoute()
    const { messageId } = await createChannelAndMessage()
    const res = await PATCH(
      asRequest('PATCH', `/api/messages/${messageId}`, { body: { message: 'x' } }),
      { params: Promise.resolve({ id: messageId }) }
    )
    expect(res.status).toBe(401)
  })

  it('returns 403 for a non-owner edit', async () => {
    const { PATCH } = await importRoute()
    const other = await createTestUser(ctx.pool, { role: 'employee' })
    userIds.push(other.id)
    const { messageId } = await createChannelAndMessage()

    const res = await PATCH(
      asRequest('PATCH', `/api/messages/${messageId}`, {
        cookie: other.sessionCookie,
        body: { message: 'hijacked' },
      }),
      { params: Promise.resolve({ id: messageId }) }
    )
    expect(res.status).toBe(403)
  })
})

describe('DELETE /api/messages/[id] — audit log', () => {
  it('writes a message.delete audit row with actorId and channel_id metadata', async () => {
    const { DELETE } = await importRoute()
    const { channelId, messageId } = await createChannelAndMessage()

    const res = await DELETE(
      asRequest('DELETE', `/api/messages/${messageId}`, {
        cookie: owner.sessionCookie,
      }),
      { params: Promise.resolve({ id: messageId }) }
    )
    expect(res.status).toBe(200)
    const body = await expectSuccess<{ deleted_ids: string[] }>(res)
    expect(body.deleted_ids).toContain(messageId)

    const found = await pollAuditRow('message.delete', messageId)
    expect(found).toBe(true)

    const { rows } = await ctx.pool.query(
      `SELECT actor_id, resource_kind, metadata FROM aaelink.audit_log
       WHERE action = 'message.delete' AND resource_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [messageId]
    )
    expect(rows[0].actor_id).toBe(owner.id)
    expect(rows[0].resource_kind).toBe('message')
    const meta = typeof rows[0].metadata === 'string' ? JSON.parse(rows[0].metadata) : rows[0].metadata
    expect(meta.channel_id).toBe(channelId)
    expect(Array.isArray(meta.deleted_ids)).toBe(true)
    expect(meta.deleted_ids).toContain(messageId)
  })

  it('returns 401 without session', async () => {
    const { DELETE } = await importRoute()
    const { messageId } = await createChannelAndMessage()
    const res = await DELETE(
      asRequest('DELETE', `/api/messages/${messageId}`),
      { params: Promise.resolve({ id: messageId }) }
    )
    expect(res.status).toBe(401)
  })

  it('returns 403 for a non-owner delete', async () => {
    const { DELETE } = await importRoute()
    const other = await createTestUser(ctx.pool, { role: 'employee' })
    userIds.push(other.id)
    const { messageId } = await createChannelAndMessage()

    const res = await DELETE(
      asRequest('DELETE', `/api/messages/${messageId}`, {
        cookie: other.sessionCookie,
      }),
      { params: Promise.resolve({ id: messageId }) }
    )
    expect(res.status).toBe(403)
  })
})
