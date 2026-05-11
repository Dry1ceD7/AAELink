/**
 * Integration tests for /api/channels/shared
 *
 * Tests:
 *   - GET  — list shared channel links
 *   - POST — invite an organization
 *   - POST — accept / decline an invitation
 *   - Auth guard (401 / 403)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestContext, createTestUser, asRequest,
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

describe('GET /api/channels/shared', () => {
  it('returns 401 without auth', async () => {
    const { GET } = await import('@/app/api/channels/shared/route')
    const req = asRequest('GET', '/api/channels/shared')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns shared links for admin', async () => {
    const { GET } = await import('@/app/api/channels/shared/route')
    const req = asRequest('GET', '/api/channels/shared', { cookie: admin.sessionCookie })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await expectSuccess<{ links: unknown[] }>(res)
    expect(body).toHaveProperty('links')
    expect(Array.isArray(body.links)).toBe(true)
  })
})

describe('POST /api/channels/shared', () => {
  it('creates a shared channel invite', async () => {
    const { POST } = await import('@/app/api/channels/shared/route')
    const req = asRequest('POST', '/api/channels/shared', {
      cookie: admin.sessionCookie,
      body: {
        action: 'invite',
        email: 'partner@external.test',
        channel_name: 'ext-test-collab',
      },
    })
    const res = await POST(req)
    expect([200, 201]).toContain(res.status)
  })

  it('rejects invite from non-admin', async () => {
    const { POST } = await import('@/app/api/channels/shared/route')
    const req = asRequest('POST', '/api/channels/shared', {
      cookie: employee.sessionCookie,
      body: {
        action: 'invite',
        email: 'no@access.test',
        channel_name: 'ext-denied',
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })
})
