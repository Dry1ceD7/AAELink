/**
 * Integration tests for /api/compliance/dlp
 *
 * Tests:
 *   - GET  — list DLP rules
 *   - POST — create a rule
 *   - POST — toggle a rule active/inactive
 *   - Auth guard (401 without session, 403 for non-admins)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestContext, createTestUser, asRequest,
  expectSuccess, expectError, cleanupTestData,
  TestContext, TestUser
} from '../helpers'

let ctx: TestContext
let admin: TestUser
let employee: TestUser
let itAdmin: TestUser
const createdIds: string[] = []

beforeAll(async () => {
  ctx = await createTestContext()
  admin = await createTestUser(ctx.pool, { role: 'super_admin' })
  employee = await createTestUser(ctx.pool, { role: 'employee' })
  itAdmin = await createTestUser(ctx.pool, { role: 'it_admin' })
  createdIds.push(admin.id, employee.id, itAdmin.id)
})

afterAll(async () => {
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('GET /api/compliance/dlp', () => {
  it('returns 401 without auth', async () => {
    const { GET } = await import('@/app/api/compliance/dlp/route')
    const req = asRequest('GET', '/api/compliance/dlp')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns 403 for non-admin', async () => {
    const { GET } = await import('@/app/api/compliance/dlp/route')
    const req = asRequest('GET', '/api/compliance/dlp', { cookie: employee.sessionCookie })
    const res = await GET(req)
    expect(res.status).toBe(403)
  })

  it('returns rule list for admin', async () => {
    const { GET } = await import('@/app/api/compliance/dlp/route')
    const req = asRequest('GET', '/api/compliance/dlp', { cookie: admin.sessionCookie })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await expectSuccess<{ rules: unknown[] }>(res)
    expect(body).toHaveProperty('rules')
    expect(Array.isArray(body.rules)).toBe(true)
  })

  it('allows it_admin (platform admin tier) — was locked out by the platform_admin role-name bug', async () => {
    const { GET } = await import('@/app/api/compliance/dlp/route')
    const req = asRequest('GET', '/api/compliance/dlp', { cookie: itAdmin.sessionCookie })
    const res = await GET(req)
    expect(res.status).toBe(200)
  })
})

describe('POST /api/compliance/dlp', () => {
  let ruleId: string

  it('creates a new DLP rule', async () => {
    const { POST } = await import('@/app/api/compliance/dlp/route')
    const req = asRequest('POST', '/api/compliance/dlp', {
      cookie: admin.sessionCookie,
      body: {
        action: 'create',
        name: 'Test SSN Pattern',
        pattern: '\\d{3}-\\d{2}-\\d{4}',
        category: 'pii',
        severity: 'high',
        action_type: 'block',
      },
    })
    const res = await POST(req)
    expect([200, 201]).toContain(res.status)
    const body = await expectSuccess<{ rule: { id: string } }>(res)
    expect(body.rule).toHaveProperty('id')
    ruleId = body.rule.id
  })

  it('toggles a rule off (via PUT)', async () => {
    const { PUT } = await import('@/app/api/compliance/dlp/route')
    const req = asRequest('PUT', '/api/compliance/dlp', {
      cookie: admin.sessionCookie,
      body: {
        rule_id: ruleId,
        is_active: false,
      },
    })
    const res = await PUT(req)
    expect(res.status).toBe(200)
  })

  it('rejects rule creation from non-admin', async () => {
    const { POST } = await import('@/app/api/compliance/dlp/route')
    const req = asRequest('POST', '/api/compliance/dlp', {
      cookie: employee.sessionCookie,
      body: { action: 'create', name: 'Nope', pattern: 'x' },
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })
})
