/**
 * Integration tests for /api/channels route
 *
 * Tests:
 *   - GET /api/channels — list channels
 *   - POST /api/channels — create channel
 *   - Auth guard (401 without session)
 *   - Channel membership
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestContext, createTestUser, createTestChannel, asRequest,
  expectSuccess, cleanupTestData,
  TestContext, TestUser
} from '../helpers'

let ctx: TestContext
let admin: TestUser
let employee: TestUser
const createdIds: string[] = []

beforeAll(async () => {
  ctx = await createTestContext()
  admin = await createTestUser(ctx.pool, { role: 'super_admin' })
  employee = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(admin.id, employee.id)
})

afterAll(async () => {
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('GET /api/channels', () => {
  it('returns 401 without session', async () => {
    const { GET } = await import('@/app/api/channels/route')
    const req = asRequest('GET', '/api/channels')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns channel list for authenticated user', async () => {
    const { GET } = await import('@/app/api/channels/route')
    const req = asRequest('GET', '/api/channels', { cookie: admin.sessionCookie })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await expectSuccess<{ channels: unknown[] }>(res)
    expect(Array.isArray(body.channels)).toBe(true)
  })
})

describe('POST /api/channels', () => {
  it('creates a public channel', async () => {
    const { POST } = await import('@/app/api/channels/route')
    const name = `test-${Date.now()}`
    const req = asRequest('POST', '/api/channels', {
      cookie: admin.sessionCookie,
      body: { name, type: 'public' },
    })
    const res = await POST(req)
    expect([200, 201]).toContain(res.status)
    const body = await expectSuccess<{ channel: { id: string; name: string } }>(res)
    expect(body.channel.name).toBe(name)
  })

  it('rejects empty channel name', async () => {
    const { POST } = await import('@/app/api/channels/route')
    const req = asRequest('POST', '/api/channels', {
      cookie: admin.sessionCookie,
      body: { name: '', type: 'public' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})

describe('Channel membership', () => {
  it('creator is automatically added as member', async () => {
    const channel = await createTestChannel(ctx.pool, admin.id)
    const { rows } = await ctx.pool.query(
      `SELECT * FROM aaelink.channel_members WHERE channel_id = $1 AND user_id = $2`,
      [channel.id, admin.id]
    )
    expect(rows.length).toBe(1)
    expect(rows[0].role).toBe('admin')
  })
})
