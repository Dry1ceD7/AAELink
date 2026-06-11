/**
 * Integration tests for /api/compliance/barriers (Slice 7 admin compliance).
 *
 * The InformationBarriers admin panel reads/writes information barriers here.
 * Coverage:
 *   - auth guards (401 / 403) on GET (platform-admin) and POST (super_admin)
 *   - POST creates a custom barrier; department/group types are rejected
 *   - GET lists it back
 *   - PATCH toggles is_active
 *   - DELETE removes it
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestContext, createTestUser, asRequest, cleanupTestData,
  TestContext, TestUser,
} from '../helpers'

let ctx: TestContext
let superAdmin: TestUser
let employee: TestUser
const userIds: string[] = []
const barrierIds: string[] = []

beforeAll(async () => {
  ctx = await createTestContext()
  superAdmin = await createTestUser(ctx.pool, { role: 'super_admin' })
  employee = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(superAdmin.id, employee.id)
})

afterAll(async () => {
  if (barrierIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.information_barriers WHERE id = ANY($1)`, [barrierIds])
  }
  await cleanupTestData(ctx.pool, userIds)
  await ctx.cleanup()
})

describe('GET /api/compliance/barriers — auth', () => {
  it('returns 401 without a session', async () => {
    const { GET } = await import('@/app/api/compliance/barriers/route')
    const res = await GET(asRequest('GET', '/api/compliance/barriers'))
    expect(res.status).toBe(401)
  })

  it('returns 403 for a non-admin', async () => {
    const { GET } = await import('@/app/api/compliance/barriers/route')
    const res = await GET(asRequest('GET', '/api/compliance/barriers', { cookie: employee.sessionCookie }))
    expect(res.status).toBe(403)
  })
})

describe('POST /api/compliance/barriers — auth + validation', () => {
  it('returns 403 for a non-super-admin', async () => {
    const { POST } = await import('@/app/api/compliance/barriers/route')
    const res = await POST(asRequest('POST', '/api/compliance/barriers', {
      cookie: employee.sessionCookie,
      body: { name: 'x', group_a_ids: ['a'], group_b_ids: ['b'] },
    }))
    expect(res.status).toBe(403)
  })

  it('rejects a department-type barrier (not enforceable)', async () => {
    const { POST } = await import('@/app/api/compliance/barriers/route')
    const res = await POST(asRequest('POST', '/api/compliance/barriers', {
      cookie: superAdmin.sessionCookie,
      body: { name: 'Dept barrier', type: 'department', group_a_ids: ['a'], group_b_ids: ['b'] },
    }))
    expect(res.status).toBe(400)
  })
})

describe('barriers CRUD lifecycle', () => {
  it('POST creates a custom barrier (super_admin)', async () => {
    const { POST } = await import('@/app/api/compliance/barriers/route')
    const res = await POST(asRequest('POST', '/api/compliance/barriers', {
      cookie: superAdmin.sessionCookie,
      body: { name: 'Banking <-> Advisory', type: 'custom', group_a_ids: [superAdmin.id], group_b_ids: [employee.id] },
    }))
    expect(res.status).toBe(201)
    const body = (await res.json()) as { barrier: { id: string; is_active: boolean } }
    expect(body.barrier.is_active).toBe(true)
    barrierIds.push(body.barrier.id)
  })

  it('GET lists the created barrier', async () => {
    const { GET } = await import('@/app/api/compliance/barriers/route')
    const res = await GET(asRequest('GET', '/api/compliance/barriers', { cookie: superAdmin.sessionCookie }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { barriers: Array<{ id: string }> }
    expect(body.barriers.some(b => b.id === barrierIds[0])).toBe(true)
  })

  it('PATCH toggles is_active off', async () => {
    const { PATCH } = await import('@/app/api/compliance/barriers/route')
    const res = await PATCH(asRequest('PATCH', '/api/compliance/barriers', {
      cookie: superAdmin.sessionCookie,
      query: { barrier_id: barrierIds[0] },
      body: { is_active: false },
    }))
    expect(res.status).toBe(200)
    const { rows } = await ctx.pool.query<{ is_active: boolean }>(
      `SELECT is_active FROM aaelink.information_barriers WHERE id = $1`, [barrierIds[0]]
    )
    expect(rows[0]?.is_active).toBe(false)
  })

  it('DELETE removes the barrier', async () => {
    const { DELETE } = await import('@/app/api/compliance/barriers/route')
    const res = await DELETE(asRequest('DELETE', '/api/compliance/barriers', {
      cookie: superAdmin.sessionCookie,
      query: { barrier_id: barrierIds[0] },
    }))
    expect(res.status).toBe(200)
    const { rows } = await ctx.pool.query(
      `SELECT id FROM aaelink.information_barriers WHERE id = $1`, [barrierIds[0]]
    )
    expect(rows).toHaveLength(0)
    barrierIds.shift()
  })
})
