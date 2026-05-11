/**
 * Integration tests for /api/threads route
 *
 * Tests:
 *   - GET /api/threads — list threaded conversations
 *   - Auth guard (401 without session)
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

describe('GET /api/threads', () => {
  it('returns 401 without session', async () => {
    const { GET } = await import('@/app/api/threads/route')
    const req = asRequest('GET', '/api/threads')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns threads list for authenticated user', async () => {
    const { GET } = await import('@/app/api/threads/route')
    const { rows: [ws] } = await ctx.pool.query(`SELECT id FROM aaelink.workspaces ORDER BY created_at LIMIT 1`)
    if (!ws) return

    const req = asRequest('GET', '/api/threads', {
      cookie: admin.sessionCookie,
      query: { workspace_id: ws.id }
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await expectSuccess<{ threads: unknown[] }>(res)
    expect(Array.isArray(body.threads)).toBe(true)
  })
})
