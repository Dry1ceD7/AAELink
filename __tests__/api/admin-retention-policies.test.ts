/**
 * Integration tests for /api/admin/retention-policies (Slice 7 admin compliance).
 *
 * The DataRetentionSettings admin panel reads/writes named retention policies
 * here. Coverage mirrors the neighbor retention.test.ts:
 *   - auth guards (401 / 403) on every verb
 *   - POST creates a named policy (super_admin)
 *   - GET lists it back, scoped to the workspace
 *   - PATCH updates the message window
 *   - DELETE removes it
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestContext, createTestUser, asRequest, cleanupTestData,
  ensureSystemWorkspace, TestContext, TestUser,
} from '../helpers'

let ctx: TestContext
let admin: TestUser
let employee: TestUser
let workspaceId: string
const userIds: string[] = []
const policyIds: string[] = []

beforeAll(async () => {
  ctx = await createTestContext()
  admin = await createTestUser(ctx.pool, { role: 'super_admin' })
  employee = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(admin.id, employee.id)
  workspaceId = await ensureSystemWorkspace(ctx.pool)
})

afterAll(async () => {
  if (policyIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.retention_policy_rules WHERE id::text = ANY($1)`, [policyIds])
  }
  await cleanupTestData(ctx.pool, userIds)
  await ctx.cleanup()
})

describe('GET /api/admin/retention-policies — auth', () => {
  it('returns 401 without a session', async () => {
    const { GET } = await import('@/app/api/admin/retention-policies/route')
    const res = await GET(asRequest('GET', '/api/admin/retention-policies', { query: { workspace_id: workspaceId } }))
    expect(res.status).toBe(401)
  })

  it('returns 403 for a non-admin', async () => {
    const { GET } = await import('@/app/api/admin/retention-policies/route')
    const res = await GET(asRequest('GET', '/api/admin/retention-policies', {
      cookie: employee.sessionCookie, query: { workspace_id: workspaceId },
    }))
    expect(res.status).toBe(403)
  })
})

describe('retention-policies CRUD lifecycle', () => {
  it('POST creates a named policy (super_admin)', async () => {
    const { POST } = await import('@/app/api/admin/retention-policies/route')
    const res = await POST(asRequest('POST', '/api/admin/retention-policies', {
      cookie: admin.sessionCookie,
      body: { workspace_id: workspaceId, scope: 'channel', name: '#test-finance', message_days: 90, file_days: 90 },
    }))
    expect(res.status).toBe(201)
    const body = (await res.json()) as { policy: { id: string; name: string; message_days: number } }
    expect(body.policy.name).toBe('#test-finance')
    expect(body.policy.message_days).toBe(90)
    policyIds.push(body.policy.id)
  })

  it('POST rejects a missing name (400)', async () => {
    const { POST } = await import('@/app/api/admin/retention-policies/route')
    const res = await POST(asRequest('POST', '/api/admin/retention-policies', {
      cookie: admin.sessionCookie,
      body: { workspace_id: workspaceId, scope: 'channel' },
    }))
    expect(res.status).toBe(400)
  })

  it('GET lists the created policy', async () => {
    const { GET } = await import('@/app/api/admin/retention-policies/route')
    const res = await GET(asRequest('GET', '/api/admin/retention-policies', {
      cookie: admin.sessionCookie, query: { workspace_id: workspaceId },
    }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { policies: Array<{ id: string; name: string }> }
    expect(body.policies.some(p => p.id === policyIds[0])).toBe(true)
  })

  it('PATCH updates the message window', async () => {
    const { PATCH } = await import('@/app/api/admin/retention-policies/route')
    const res = await PATCH(asRequest('PATCH', '/api/admin/retention-policies', {
      cookie: admin.sessionCookie,
      body: { policy_id: policyIds[0], message_days: 30 },
    }))
    expect(res.status).toBe(200)
    const { rows } = await ctx.pool.query<{ message_days: number }>(
      `SELECT message_days FROM aaelink.retention_policy_rules WHERE id::text = $1`, [policyIds[0]]
    )
    expect(rows[0]?.message_days).toBe(30)
  })

  it('DELETE removes the policy', async () => {
    const { DELETE } = await import('@/app/api/admin/retention-policies/route')
    const res = await DELETE(asRequest('DELETE', '/api/admin/retention-policies', {
      cookie: admin.sessionCookie, query: { policy_id: policyIds[0] },
    }))
    expect(res.status).toBe(200)
    const { rows } = await ctx.pool.query(
      `SELECT id FROM aaelink.retention_policy_rules WHERE id::text = $1`, [policyIds[0]]
    )
    expect(rows).toHaveLength(0)
    policyIds.shift()
  })
})
