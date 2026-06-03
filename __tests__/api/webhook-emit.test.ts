/**
 * Integration test: outgoing-webhook fan-out wiring (P1).
 *
 * emitWebhookEvent was implemented but never called. Posting/deleting a message
 * and toggling a reaction must now enqueue a `webhook_deliver` job + a
 * webhook_deliveries_v2 row for each matching active webhooks_v2 subscription.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, createTestChannel, asRequest,
  expectSuccess, cleanupTestData, TestContext, TestUser, TestChannel,
} from '../helpers'

let ctx: TestContext
let user: TestUser
let channel: TestChannel
let wsId: string
let webhookId: string
const createdIds: string[] = []

async function deliverJobsFor(eventType: string, channelId: string): Promise<number> {
  const { rows } = await ctx.pool.query<{ payload: string }>(
    `SELECT payload FROM aaelink.jobs WHERE type = 'webhook_deliver' AND created_by = $1`, [user.id]
  )
  return rows.filter(r => {
    try {
      const p = JSON.parse(r.payload) as { event_type?: string; payload?: string }
      if (p.event_type !== eventType) return false
      const inner = JSON.parse(p.payload || '{}') as { data?: { channel_id?: string } }
      return inner.data?.channel_id === channelId
    } catch { return false }
  }).length
}

beforeAll(async () => {
  ctx = await createTestContext()
  user = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(user.id)
  const { rows: [m] } = await ctx.pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.workspace_members WHERE user_id = $1 LIMIT 1`, [user.id]
  )
  wsId = m.workspace_id
  channel = await createTestChannel(ctx.pool, user.id, { workspaceId: wsId })

  webhookId = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.webhooks_v2 (id, name, url, secret, events, channel_id, is_active, created_by, created_at)
     VALUES ($1, 'test-wh', 'https://example.test/hook', 'shh',
             '["message.created","message.deleted","reaction.added","reaction.removed"]', '', true, $2, $3)`,
    [webhookId, user.id, Date.now()]
  )
})

afterAll(async () => {
  await ctx.pool.query(`DELETE FROM aaelink.jobs WHERE created_by = ANY($1)`, [createdIds])
  await ctx.pool.query(`DELETE FROM aaelink.webhook_deliveries_v2 WHERE webhook_id = $1`, [webhookId])
  await ctx.pool.query(`DELETE FROM aaelink.webhooks_v2 WHERE id = $1`, [webhookId])
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('outgoing webhook fan-out', () => {
  it('enqueues a webhook_deliver job + delivery row on message.created', async () => {
    const { POST } = await import('@/app/api/messages/route')
    const res = await POST(asRequest('POST', '/api/messages', {
      cookie: user.sessionCookie, body: { channel_id: channel.id, message: 'hello webhook' },
    }))
    await expectSuccess(res)
    expect(await deliverJobsFor('message.created', channel.id)).toBeGreaterThan(0)
    const { rows } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.webhook_deliveries_v2 WHERE webhook_id = $1 AND event_type = 'message.created'`, [webhookId]
    )
    expect(rows.length).toBeGreaterThan(0)
  })

  it('enqueues reaction.added then reaction.removed on toggle', async () => {
    const { POST: postMsg } = await import('@/app/api/messages/route')
    const created = await expectSuccess<{ id: string }>(await postMsg(asRequest('POST', '/api/messages', {
      cookie: user.sessionCookie, body: { channel_id: channel.id, message: 'react target' },
    })))
    const { POST: react } = await import('@/app/api/messages/reactions/route')
    await expectSuccess(await react(asRequest('POST', '/api/messages/reactions', {
      cookie: user.sessionCookie, body: { message_id: created.id, key: 'thumbs_up' },
    })))
    expect(await deliverJobsFor('reaction.added', channel.id)).toBeGreaterThan(0)
    await expectSuccess(await react(asRequest('POST', '/api/messages/reactions', {
      cookie: user.sessionCookie, body: { message_id: created.id, key: 'thumbs_up' },
    })))
    expect(await deliverJobsFor('reaction.removed', channel.id)).toBeGreaterThan(0)
  })

  it('does nothing when no active webhook subscribes to the event', async () => {
    await ctx.pool.query(`UPDATE aaelink.webhooks_v2 SET is_active = false WHERE id = $1`, [webhookId])
    const before = await deliverJobsFor('message.created', channel.id)
    const { POST } = await import('@/app/api/messages/route')
    await expectSuccess(await POST(asRequest('POST', '/api/messages', {
      cookie: user.sessionCookie, body: { channel_id: channel.id, message: 'no subscribers' },
    })))
    expect(await deliverJobsFor('message.created', channel.id)).toBe(before)
    await ctx.pool.query(`UPDATE aaelink.webhooks_v2 SET is_active = true WHERE id = $1`, [webhookId])
  })
})
