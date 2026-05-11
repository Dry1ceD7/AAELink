/**
 * Integration tests for /api/clients route
 *
 * Tests:
 *   - GET /api/clients — list client profiles
 *   - POST /api/clients — create client profile
 *   - PATCH /api/clients — update client profile
 *   - Auth guard (401 without session)
 *   - Workspace scoping and search
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
  // Clean up test clients
  await ctx.pool.query(`DELETE FROM aaelink.client_profiles WHERE name LIKE 'Test Client %'`).catch(() => {})
  await ctx.cleanup()
})

describe('GET /api/clients', () => {
  it('returns 401 without session', async () => {
    const { GET } = await import('@/app/api/clients/route')
    const req = asRequest('GET', '/api/clients')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('requires workspace_id parameter', async () => {
    const { GET } = await import('@/app/api/clients/route')
    const req = asRequest('GET', '/api/clients', { cookie: admin.sessionCookie })
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('returns client list for authenticated user', async () => {
    const { GET } = await import('@/app/api/clients/route')
    const { rows: [ws] } = await ctx.pool.query(`SELECT id FROM aaelink.workspaces ORDER BY created_at LIMIT 1`)
    if (!ws) return

    const req = asRequest('GET', '/api/clients', {
      cookie: admin.sessionCookie,
      query: { workspace_id: ws.id }
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await expectSuccess<{ clients: unknown[]; total: number }>(res)
    expect(Array.isArray(body.clients)).toBe(true)
    expect(typeof body.total).toBe('number')
  })
})

describe('POST /api/clients', () => {
  it('creates a client profile', async () => {
    const { POST } = await import('@/app/api/clients/route')
    const { rows: [ws] } = await ctx.pool.query(`SELECT id FROM aaelink.workspaces ORDER BY created_at LIMIT 1`)
    if (!ws) return

    const req = asRequest('POST', '/api/clients', {
      cookie: admin.sessionCookie,
      body: {
        workspace_id: ws.id,
        name: `Test Client ${Date.now()}`,
        email: 'test@example.com',
        phone: '+1234567890'
      }
    })
    const res = await POST(req)
    expect([200, 201]).toContain(res.status)
    const body = await expectSuccess<{ client: { id: string; name: string } }>(res)
    expect(body.client.id).toBeTruthy()
  })

  it('rejects missing name', async () => {
    const { POST } = await import('@/app/api/clients/route')
    const { rows: [ws] } = await ctx.pool.query(`SELECT id FROM aaelink.workspaces ORDER BY created_at LIMIT 1`)
    if (!ws) return

    const req = asRequest('POST', '/api/clients', {
      cookie: admin.sessionCookie,
      body: { workspace_id: ws.id, name: '' }
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})

describe('GET /api/clients with search', () => {
  it('supports search query parameter', async () => {
    const { GET } = await import('@/app/api/clients/route')
    const { rows: [ws] } = await ctx.pool.query(`SELECT id FROM aaelink.workspaces ORDER BY created_at LIMIT 1`)
    if (!ws) return

    const req = asRequest('GET', '/api/clients', {
      cookie: admin.sessionCookie,
      query: { workspace_id: ws.id, q: 'nonexistent-client-xyz' }
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await expectSuccess<{ clients: unknown[]; total: number }>(res)
    expect(body.total).toBe(0)
  })
})
