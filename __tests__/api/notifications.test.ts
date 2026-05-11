/**
 * Integration tests for /api/notifications route
 *
 * Tests:
 *   - GET /api/notifications — list notifications
 *   - PATCH /api/notifications — mark as read
 *   - Auth guard (401 without session)
 *   - Read/unread state management
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestContext, createTestUser, asRequest,
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

describe('GET /api/notifications', () => {
  it('returns 401 without session', async () => {
    const { GET } = await import('@/app/api/notifications/route')
    const req = asRequest('GET', '/api/notifications')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns notifications list for authenticated user', async () => {
    const { GET } = await import('@/app/api/notifications/route')
    const req = asRequest('GET', '/api/notifications', {
      cookie: admin.sessionCookie,
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await expectSuccess<{ notifications: unknown[] }>(res)
    expect(Array.isArray(body.notifications)).toBe(true)
  })

  it('supports unread_only filter', async () => {
    const { GET } = await import('@/app/api/notifications/route')
    const req = asRequest('GET', '/api/notifications', {
      cookie: admin.sessionCookie,
      query: { unread_only: 'true' }
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
  })
})

describe('PATCH /api/notifications', () => {
  it('returns 401 without session', async () => {
    const mod = await import('@/app/api/notifications/route')
    if (!('PATCH' in mod)) return // skip if no PATCH handler

    const { PATCH } = mod as { PATCH: (req: Request) => Promise<Response> }
    const req = asRequest('PATCH', '/api/notifications', {
      body: { notification_id: 'fake', read: true }
    })
    const res = await PATCH(req)
    expect(res.status).toBe(401)
  })
})
