/**
 * Integration tests for the data-residency admin gate (Admin parity §26).
 *
 * Regression: the GET handler previously hardcoded ['super_admin','platform_admin']
 * (an invalid role set) which locked out it_admin contrary to the canonical
 * isPlatformAdmin convention used by sibling admin routes. The gate now uses
 * isPlatformAdmin, so it_admin and super_admin get 200 and a plain member gets 403.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestContext, createTestUser, asRequest, TestContext } from '../helpers'
import { GET as getResidency } from '@/app/api/admin/data-residency/route'

let ctx: TestContext
const userIds: string[] = []

beforeAll(async () => { ctx = await createTestContext() })

afterAll(async () => {
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('admin data-residency GET gate', () => {
  it('rejects a plain member with 403', async () => {
    const member = await createTestUser(ctx.pool, { role: 'employee' })
    userIds.push(member.id)
    const res = await getResidency(asRequest('GET', '/api/admin/data-residency', { cookie: member.sessionCookie }) as never)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('forbidden')
  })

  it('allows it_admin with 200 (regression: previously locked out)', async () => {
    const admin = await createTestUser(ctx.pool, { role: 'it_admin' })
    userIds.push(admin.id)
    const res = await getResidency(asRequest('GET', '/api/admin/data-residency', { cookie: admin.sessionCookie }) as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.config).toBeDefined()
    expect(Array.isArray(body.available_regions)).toBe(true)
  })

  it('allows super_admin with 200', async () => {
    const admin = await createTestUser(ctx.pool, { role: 'super_admin' })
    userIds.push(admin.id)
    const res = await getResidency(asRequest('GET', '/api/admin/data-residency', { cookie: admin.sessionCookie }) as never)
    expect(res.status).toBe(200)
  })

  it('rejects an unauthenticated request with 401', async () => {
    const res = await getResidency(asRequest('GET', '/api/admin/data-residency') as never)
    expect(res.status).toBe(401)
  })
})
