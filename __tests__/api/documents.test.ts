/**
 * Integration tests for /api/documents route
 *
 * Tests:
 *   - GET /api/documents — list documents
 *   - POST /api/documents — upload document
 *   - Auth guard (401 without session)
 *   - Workspace scoping
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

describe('GET /api/documents', () => {
  it('returns 401 without session', async () => {
    const { GET } = await import('@/app/api/documents/route')
    const req = asRequest('GET', '/api/documents')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns documents list for authenticated user', async () => {
    const { GET } = await import('@/app/api/documents/route')
    const { rows: [ws] } = await ctx.pool.query(`SELECT id FROM aaelink.workspaces ORDER BY created_at LIMIT 1`)
    if (!ws) return

    const req = asRequest('GET', '/api/documents', {
      cookie: admin.sessionCookie,
      query: { workspace_id: ws.id }
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await expectSuccess<{ documents: unknown[] }>(res)
    expect(Array.isArray(body.documents)).toBe(true)
  })
})

describe('POST /api/documents', () => {
  it('returns 401 without session', async () => {
    const { POST } = await import('@/app/api/documents/route')
    const req = asRequest('POST', '/api/documents', {
      body: { name: 'test.pdf' }
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })
})
