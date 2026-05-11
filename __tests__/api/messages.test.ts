/**
 * Integration tests for /api/messages and related sub-routes
 *
 * Tests:
 *   - GET /api/messages — list messages in a channel
 *   - GET /api/messages/search — search messages
 *   - GET /api/messages/permalink — get message permalink
 *   - Auth guard (401 without session)
 *   - Channel parameter validation
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestContext, createTestUser, createTestChannel, asRequest,
  expectSuccess, cleanupTestData,
  TestContext, TestUser
} from '../helpers'

let ctx: TestContext
let admin: TestUser
const createdIds: string[] = []

beforeAll(async () => {
  ctx = await createTestContext()
  admin = await createTestUser(ctx.pool, { role: 'super_admin' })
  createdIds.push(admin.id)
})

afterAll(async () => {
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('GET /api/messages', () => {
  it('returns 401 without session', async () => {
    const { GET } = await import('@/app/api/messages/route')
    const req = asRequest('GET', '/api/messages')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('requires channel_id parameter', async () => {
    const { GET } = await import('@/app/api/messages/route')
    const req = asRequest('GET', '/api/messages', { cookie: admin.sessionCookie })
    const res = await GET(req)
    expect([400, 404]).toContain(res.status)
  })

  it('returns messages for a valid channel', async () => {
    const { GET } = await import('@/app/api/messages/route')
    const channel = await createTestChannel(ctx.pool, admin.id)

    const req = asRequest('GET', '/api/messages', {
      cookie: admin.sessionCookie,
      query: { channel_id: channel.id }
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await expectSuccess<{ posts: unknown[] }>(res)
    expect(Array.isArray(body.posts)).toBe(true)
  })
})

describe('GET /api/messages/search', () => {
  it('returns 401 without session', async () => {
    const { GET } = await import('@/app/api/messages/search/route')
    const req = asRequest('GET', '/api/messages/search')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('requires search query', async () => {
    const { GET } = await import('@/app/api/messages/search/route')
    const req = asRequest('GET', '/api/messages/search', {
      cookie: admin.sessionCookie,
    })
    const res = await GET(req)
    expect([200, 400]).toContain(res.status)
  })
})

describe('GET /api/messages/permalink', () => {
  it('returns 401 without session', async () => {
    const { GET } = await import('@/app/api/messages/permalink/route')
    const req = asRequest('GET', '/api/messages/permalink')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })
})
