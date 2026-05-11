/**
 * Integration tests for /api/admin/prometheus
 *
 * Tests:
 *   - GET — returns OpenMetrics text format
 *   - Auth guard (401 without session, 403 for non-admin)
 *   - Content-type validation
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestContext, createTestUser, asRequest,
  cleanupTestData,
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

describe('GET /api/admin/prometheus', () => {
  it('returns 401 without auth', async () => {
    const { GET } = await import('@/app/api/admin/prometheus/route')
    const req = asRequest('GET', '/api/admin/prometheus')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns 403 for non-admin', async () => {
    const { GET } = await import('@/app/api/admin/prometheus/route')
    const req = asRequest('GET', '/api/admin/prometheus', { cookie: employee.sessionCookie })
    const res = await GET(req)
    expect(res.status).toBe(403)
  })

  it('returns OpenMetrics text for admin', async () => {
    const { GET } = await import('@/app/api/admin/prometheus/route')
    const req = asRequest('GET', '/api/admin/prometheus', { cookie: admin.sessionCookie })
    const res = await GET(req)
    expect(res.status).toBe(200)

    const contentType = res.headers.get('content-type') || ''
    expect(contentType).toContain('text/plain')

    const body = await res.text()
    expect(body).toContain('aaelink_')
    expect(body).toContain('# HELP')
    expect(body).toContain('# TYPE')
  })
})
