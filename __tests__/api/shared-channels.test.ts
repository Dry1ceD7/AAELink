/**
 * Integration tests for /api/channels/shared
 *
 * Tests:
 *   - GET  — list shared channel links (returns { shared_channels, total })
 *   - POST — invite an organization (action: 'create_invite', requires channel_id)
 *   - Auth guard (401 / 403)
 *
 * Note: GET returns body.shared_channels (not body.links).
 *       POST action is 'create_invite' (not 'invite'), and requires channel_id.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, createTestChannel, asRequest,
  expectSuccess, cleanupTestData,
  TestContext, TestUser
} from '../helpers'

let ctx: TestContext
let admin: TestUser
let employee: TestUser
let channelId: string
const createdIds: string[] = []

beforeAll(async () => {
  ctx = await createTestContext()
  admin = await createTestUser(ctx.pool, { role: 'super_admin' })
  employee = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(admin.id, employee.id)

  // Create a channel that can be used for shared channel invite
  const ch = await createTestChannel(ctx.pool, admin.id, { name: `shared-test-${randomUUID().slice(0, 8)}` })
  channelId = ch.id
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

  it('returns shared_channels list for admin', async () => {
    const { GET } = await import('@/app/api/channels/shared/route')
    const req = asRequest('GET', '/api/channels/shared', { cookie: admin.sessionCookie })
    const res = await GET(req)
    expect(res.status).toBe(200)
    // Route returns { shared_channels: [...], total: number }
    const body = await expectSuccess<{ shared_channels: unknown[]; total: number }>(res)
    expect(body).toHaveProperty('shared_channels')
    expect(Array.isArray(body.shared_channels)).toBe(true)
  })
})

describe('POST /api/channels/shared', () => {
  it('creates a shared channel invite (action: create_invite)', async () => {
    const { POST } = await import('@/app/api/channels/shared/route')
    const req = asRequest('POST', '/api/channels/shared', {
      cookie: admin.sessionCookie,
      body: {
        action: 'create_invite',
        channel_id: channelId,
        remote_org_name: 'Partner Corp',
        remote_org_url: 'https://partner.example.com',
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
        action: 'create_invite',
        channel_id: channelId,
      },
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })
})
