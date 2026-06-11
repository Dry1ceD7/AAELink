/**
 * Integration tests for /api/admin/emm-policy (Slice 7 admin compliance).
 *
 * The EMMPanel "Policies" tab loads the EMM policy here and persists toggle
 * changes via PATCH (an alias for PUT added in this slice). Coverage:
 *   - GET auth guards (401 / 403) + 200 returns a policy
 *   - PATCH auth guards (403 for non-admin)
 *   - PATCH persists a partial patch and merges defaults
 *   - PATCH rejects an out-of-range value (400)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestContext, createTestUser, asRequest, cleanupTestData,
  TestContext, TestUser,
} from '../helpers'
import { updateEmmPolicy, DEFAULT_EMM_POLICY } from '@/lib/enterprise/deviceManagement'

let ctx: TestContext
let admin: TestUser
let employee: TestUser
const userIds: string[] = []

beforeAll(async () => {
  ctx = await createTestContext()
  admin = await createTestUser(ctx.pool, { role: 'super_admin' })
  employee = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(admin.id, employee.id)
})

afterAll(async () => {
  await updateEmmPolicy(ctx.pool, { ...DEFAULT_EMM_POLICY })
  await cleanupTestData(ctx.pool, userIds)
  await ctx.cleanup()
})

describe('GET /api/admin/emm-policy — auth', () => {
  it('returns 401 without a session', async () => {
    const { GET } = await import('@/app/api/admin/emm-policy/route')
    const res = await GET(asRequest('GET', '/api/admin/emm-policy'))
    expect(res.status).toBe(401)
  })

  it('returns 403 for a non-admin', async () => {
    const { GET } = await import('@/app/api/admin/emm-policy/route')
    const res = await GET(asRequest('GET', '/api/admin/emm-policy', { cookie: employee.sessionCookie }))
    expect(res.status).toBe(403)
  })

  it('returns the policy for an admin', async () => {
    const { GET } = await import('@/app/api/admin/emm-policy/route')
    const res = await GET(asRequest('GET', '/api/admin/emm-policy', { cookie: admin.sessionCookie }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { policy: { screen_lock_required: boolean } }
    expect(typeof body.policy.screen_lock_required).toBe('boolean')
  })
})

describe('PATCH /api/admin/emm-policy', () => {
  it('returns 403 for a non-admin', async () => {
    const { PATCH } = await import('@/app/api/admin/emm-policy/route')
    const res = await PATCH(asRequest('PATCH', '/api/admin/emm-policy', {
      cookie: employee.sessionCookie,
      body: { screen_lock_required: true },
    }))
    expect(res.status).toBe(403)
  })

  it('persists a partial patch and merges defaults', async () => {
    const { PATCH } = await import('@/app/api/admin/emm-policy/route')
    const res = await PATCH(asRequest('PATCH', '/api/admin/emm-policy', {
      cookie: admin.sessionCookie,
      body: { screen_lock_required: true, screen_lock_timeout_minutes: 15 },
    }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { policy: { screen_lock_required: boolean; screen_lock_timeout_minutes: number; require_trusted_device: boolean } }
    expect(body.policy.screen_lock_required).toBe(true)
    expect(body.policy.screen_lock_timeout_minutes).toBe(15)
    expect(body.policy.require_trusted_device).toBe(false)
  })

  it('rejects an out-of-range value (400)', async () => {
    const { PATCH } = await import('@/app/api/admin/emm-policy/route')
    const res = await PATCH(asRequest('PATCH', '/api/admin/emm-policy', {
      cookie: admin.sessionCookie,
      body: { screen_lock_timeout_minutes: -1 },
    }))
    expect(res.status).toBe(400)
  })
})
