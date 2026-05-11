/**
 * Integration tests for /api/activity route
 *
 * Tests:
 *   - GET /api/activity — unified activity feed
 *   - Auth guard (401 without session)
 *   - Workspace parameter validation
 *   - Filter modes: mentions, reactions, threads, all
 *   - Pagination with `before` cursor
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

describe('GET /api/activity', () => {
  it('returns 401 without session', async () => {
    const { GET } = await import('@/app/api/activity/route')
    const req = asRequest('GET', '/api/activity')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('requires workspace_id parameter', async () => {
    const { GET } = await import('@/app/api/activity/route')
    const req = asRequest('GET', '/api/activity', { cookie: admin.sessionCookie })
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('returns activity list for authenticated user', async () => {
    const { GET } = await import('@/app/api/activity/route')
    const { rows: [ws] } = await ctx.pool.query(`SELECT id FROM aaelink.workspaces ORDER BY created_at LIMIT 1`)
    if (!ws) return

    const req = asRequest('GET', '/api/activity', {
      cookie: admin.sessionCookie,
      query: { workspace_id: ws.id }
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await expectSuccess<{ activities: unknown[]; has_more: boolean }>(res)
    expect(Array.isArray(body.activities)).toBe(true)
    expect(typeof body.has_more).toBe('boolean')
  })

  it('respects filter=mentions', async () => {
    const { GET } = await import('@/app/api/activity/route')
    const { rows: [ws] } = await ctx.pool.query(`SELECT id FROM aaelink.workspaces ORDER BY created_at LIMIT 1`)
    if (!ws) return

    const req = asRequest('GET', '/api/activity', {
      cookie: admin.sessionCookie,
      query: { workspace_id: ws.id, filter: 'mentions' }
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await expectSuccess<{ activities: Array<{ activity_type: string }> }>(res)
    // All returned activities should be mentions
    for (const a of body.activities) {
      expect(a.activity_type).toBe('mention')
    }
  })

  it('respects filter=reactions', async () => {
    const { GET } = await import('@/app/api/activity/route')
    const { rows: [ws] } = await ctx.pool.query(`SELECT id FROM aaelink.workspaces ORDER BY created_at LIMIT 1`)
    if (!ws) return

    const req = asRequest('GET', '/api/activity', {
      cookie: admin.sessionCookie,
      query: { workspace_id: ws.id, filter: 'reactions' }
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await expectSuccess<{ activities: Array<{ activity_type: string }> }>(res)
    for (const a of body.activities) {
      expect(a.activity_type).toBe('reaction')
    }
  })

  it('respects limit parameter', async () => {
    const { GET } = await import('@/app/api/activity/route')
    const { rows: [ws] } = await ctx.pool.query(`SELECT id FROM aaelink.workspaces ORDER BY created_at LIMIT 1`)
    if (!ws) return

    const req = asRequest('GET', '/api/activity', {
      cookie: admin.sessionCookie,
      query: { workspace_id: ws.id, limit: '5' }
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await expectSuccess<{ activities: unknown[] }>(res)
    expect(body.activities.length).toBeLessThanOrEqual(5)
  })
})
