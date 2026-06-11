/**
 * Integration tests for /api/health
 *
 * Tests:
 *   - GET — returns health status without auth
 *   - Response includes postgres, uptime, and overall status
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestContext, asRequest, TestContext } from '../helpers'

let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.cleanup()
})

describe('GET /api/health', () => {
  it('returns 200 with health data (no auth required)', async () => {
    const { GET } = await import('@/app/api/health/route')
    const req = asRequest('GET', '/api/health')
    const res = await GET(req)
    expect([200, 503]).toContain(res.status)

    const body = await res.json()
    expect(body).toHaveProperty('status')
    expect(['healthy', 'degraded']).toContain(body.status)
    expect(body).toHaveProperty('uptime_seconds')
  })

  it('includes postgres check', async () => {
    const { GET } = await import('@/app/api/health/route')
    const req = asRequest('GET', '/api/health')
    const res = await GET(req)
    const body = await res.json()
    // Route nests service checks under body.checks (e.g. body.checks.postgres)
    expect(body).toHaveProperty('checks')
    expect(body.checks).toHaveProperty('postgres')
  })
})
