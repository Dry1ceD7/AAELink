/**
 * Integration test for POST /api/notifications/push `send` action.
 *
 * Asserts the send action both writes a push_log row AND enqueues a
 * `push_deliver` job into aaelink.jobs (with log_id) so the worker
 * (lib/infra/worker.ts → lib/notifications/pushDelivery.ts) can deliver it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, asRequest,
  expectSuccess, expectError, cleanupTestData,
  TestContext, TestUser,
} from '../helpers'

let ctx: TestContext
let admin: TestUser
let employee: TestUser
let target: TestUser
const createdIds: string[] = []
const logIds: string[] = []
const jobIds: string[] = []

beforeAll(async () => {
  ctx = await createTestContext()
  admin = await createTestUser(ctx.pool, { role: 'super_admin' })
  employee = await createTestUser(ctx.pool, { role: 'employee' })
  target = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(admin.id, employee.id, target.id)
})

afterAll(async () => {
  if (jobIds.length) await ctx.pool.query(`DELETE FROM aaelink.jobs WHERE id = ANY($1)`, [jobIds])
  if (logIds.length) await ctx.pool.query(`DELETE FROM aaelink.push_log WHERE id = ANY($1)`, [logIds])
  await ctx.pool.query(`DELETE FROM aaelink.push_log WHERE user_id = ANY($1)`, [createdIds])
  await ctx.pool.query(`DELETE FROM aaelink.jobs WHERE created_by = ANY($1)`, [createdIds])
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('POST /api/notifications/push — send action enqueue', () => {
  it('returns 401 without session', async () => {
    const { POST } = await import('@/app/api/notifications/push/route')
    const res = await POST(asRequest('POST', '/api/notifications/push', {
      body: { action: 'send', user_ids: [target.id], title: 'Hi' },
    }))
    expect(res.status).toBe(401)
  })

  it('forbids non-admins from sending', async () => {
    const { POST } = await import('@/app/api/notifications/push/route')
    const res = await POST(asRequest('POST', '/api/notifications/push', {
      cookie: employee.sessionCookie,
      body: { action: 'send', user_ids: [target.id], title: 'Hi' },
    }))
    await expectError(res, 403, 'forbidden')
  })

  it('requires user_ids', async () => {
    const { POST } = await import('@/app/api/notifications/push/route')
    const res = await POST(asRequest('POST', '/api/notifications/push', {
      cookie: admin.sessionCookie,
      body: { action: 'send', user_ids: [], title: 'Hi' },
    }))
    await expectError(res, 400, 'user_ids_required')
  })

  it('writes a push_log row AND enqueues a push_deliver job with log_id', async () => {
    const { POST } = await import('@/app/api/notifications/push/route')
    const channelId = randomUUID()
    const res = await POST(asRequest('POST', '/api/notifications/push', {
      cookie: admin.sessionCookie,
      body: {
        action: 'send', user_ids: [target.id],
        title: 'Ping', body_text: 'You have a message',
        channel_id: channelId, priority: 'high', badge_count: 2,
      },
    }))
    const body = await expectSuccess<{ queued: number; priority: string }>(res)
    expect(body.queued).toBe(1)
    expect(body.priority).toBe('high')

    // push_log row was written
    const { rows: logRows } = await ctx.pool.query<{ id: string; status: string }>(
      `SELECT id, status FROM aaelink.push_log WHERE user_id = $1 AND channel_id = $2`,
      [target.id, channelId]
    )
    expect(logRows.length).toBe(1)
    logIds.push(logRows[0].id)
    expect(logRows[0].status).toBe('queued')

    // a push_deliver job was enqueued referencing that log row
    const { rows: jobRows } = await ctx.pool.query<{ id: string; type: string; status: string; priority: number; payload: string }>(
      `SELECT id, type, status, priority, payload FROM aaelink.jobs
       WHERE type = 'push_deliver' AND created_by = $1 ORDER BY created_at DESC`,
      [admin.id]
    )
    const match = jobRows.find(j => {
      try { return (JSON.parse(j.payload) as { log_id?: string }).log_id === logRows[0].id } catch { return false }
    })
    expect(match).toBeTruthy()
    jobIds.push(match!.id)
    expect(match!.status).toBe('pending')

    const payload = JSON.parse(match!.payload) as {
      user_id: string; title: string; body: string; channel_id: string
      badge_count: number; silent: boolean; priority: string; log_id: string
    }
    expect(payload.user_id).toBe(target.id)
    expect(payload.title).toBe('Ping')
    expect(payload.body).toBe('You have a message')
    expect(payload.channel_id).toBe(channelId)
    expect(payload.badge_count).toBe(2)
    expect(payload.silent).toBe(false)
    expect(payload.priority).toBe('high')
    expect(payload.log_id).toBe(logRows[0].id)
  })
})
