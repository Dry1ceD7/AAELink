/**
 * Integration tests for password-policy enforcement (Identity parity §27).
 *
 * Covers: admin policy CRUD (GET/PUT, platform-admin gated, CSRF), change-password
 * policy + history-reuse rejection, and login password-expiry flag. Pure validator
 * matrix lives in tests/passwordPolicy.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, createTestUser, asRequest, TestContext } from '../helpers'
import { hashPassword } from '@/lib/auth/password'
import {
  DEFAULT_PASSWORD_POLICY,
  updatePasswordPolicy,
  invalidatePasswordPolicyCache,
} from '@/lib/auth/passwordPolicy'
import { GET as getPolicy, PUT as putPolicy } from '@/app/api/admin/password-policy/route'
import { POST as changePassword } from '@/app/api/auth/change-password/route'
import { POST as login } from '@/app/api/auth/login/route'

let ctx: TestContext
const userIds: string[] = []

async function resetPolicy() {
  await updatePasswordPolicy(ctx.pool, { ...DEFAULT_PASSWORD_POLICY })
  invalidatePasswordPolicyCache()
}

/** Create a real-credential user (createTestUser uses a non-login hash). */
async function mkLoginUser(password: string): Promise<{ id: string; email: string; username: string; cookie: string }> {
  const id = randomUUID()
  const suffix = id.slice(0, 8)
  const email = `pwp-${suffix}@test.local`
  const username = `pwp_${suffix}`
  const now = Date.now()
  await ctx.pool.query(
    `INSERT INTO aaelink.users (id, username, email, password_hash, created_at, last_seen_at, platform_role, password_changed_at)
     VALUES ($1, $2, $3, $4, $5, 0, 'employee', $5)`,
    [id, username, email, hashPassword(password), now]
  )
  const sessionId = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.sessions (id, user_id, expires_at, user_agent, ip_address, created_at, last_active_at)
     VALUES ($1, $2, $3, 'vitest', '127.0.0.1', $4, $4)`,
    [sessionId, id, now + 86_400_000, now]
  )
  userIds.push(id)
  return { id, email, username, cookie: `AAELINK_SESSION=${sessionId}` }
}

beforeAll(async () => { ctx = await createTestContext() })

afterEach(async () => { await resetPolicy() })

afterAll(async () => {
  await resetPolicy()
  await ctx.pool.query(`DELETE FROM aaelink.password_history WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('admin password-policy CRUD', () => {
  it('GET requires platform admin', async () => {
    const employee = await createTestUser(ctx.pool, { role: 'employee' })
    userIds.push(employee.id)
    const res = await getPolicy(asRequest('GET', '/api/admin/password-policy', { cookie: employee.sessionCookie }) as never)
    expect(res.status).toBe(403)
  })

  it('admin GET returns the policy, PUT updates it', async () => {
    const admin = await createTestUser(ctx.pool, { role: 'it_admin' })
    userIds.push(admin.id)

    const getRes = await getPolicy(asRequest('GET', '/api/admin/password-policy', { cookie: admin.sessionCookie }) as never)
    expect(getRes.status).toBe(200)
    expect((await getRes.json()).policy.min_length).toBe(8)

    const putRes = await putPolicy(asRequest('PUT', '/api/admin/password-policy', {
      cookie: admin.sessionCookie,
      body: { min_length: 12, require_digit: true, history_count: 2 },
    }) as never)
    expect(putRes.status).toBe(200)
    const body = await putRes.json()
    expect(body.policy.min_length).toBe(12)
    expect(body.policy.require_digit).toBe(true)
    invalidatePasswordPolicyCache()
  })

  it('PUT rejects an invalid patch', async () => {
    const admin = await createTestUser(ctx.pool, { role: 'super_admin' })
    userIds.push(admin.id)
    const res = await putPolicy(asRequest('PUT', '/api/admin/password-policy', {
      cookie: admin.sessionCookie,
      body: { min_length: 0 },
    }) as never)
    expect(res.status).toBe(400)
  })
})

describe('change-password enforcement', () => {
  it('rejects a password violating the complexity policy', async () => {
    const u = await mkLoginUser('CurrentPass1!')
    await updatePasswordPolicy(ctx.pool, { min_length: 8, require_digit: true, require_symbol: true })
    invalidatePasswordPolicyCache()

    const res = await changePassword(asRequest('POST', '/api/auth/change-password', {
      cookie: u.cookie,
      body: { current_password: 'CurrentPass1!', new_password: 'nodigitsorsymbols' },
    }) as never)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('password_policy_violation')
    expect(body.detail).toContain('require_digit')
    expect(body.detail).toContain('require_symbol')
  })

  it('accepts a compliant new password and stamps password_changed_at', async () => {
    const u = await mkLoginUser('CurrentPass1!')
    await updatePasswordPolicy(ctx.pool, { min_length: 8, require_digit: true })
    invalidatePasswordPolicyCache()

    const res = await changePassword(asRequest('POST', '/api/auth/change-password', {
      cookie: u.cookie,
      body: { current_password: 'CurrentPass1!', new_password: 'BrandNew2Pass' },
    }) as never)
    expect(res.status).toBe(200)
    const { rows } = await ctx.pool.query<{ password_changed_at: string }>(
      `SELECT password_changed_at::text FROM aaelink.users WHERE id = $1`, [u.id]
    )
    expect(Number(rows[0].password_changed_at)).toBeGreaterThan(0)
  })

  it('rejects reuse of a recent password when history is on', async () => {
    const u = await mkLoginUser('FirstPass11')
    await updatePasswordPolicy(ctx.pool, { min_length: 8, history_count: 3 })
    invalidatePasswordPolicyCache()

    // Change FirstPass11 -> SecondPass22 (history now remembers FirstPass11).
    const r1 = await changePassword(asRequest('POST', '/api/auth/change-password', {
      cookie: u.cookie,
      body: { current_password: 'FirstPass11', new_password: 'SecondPass22' },
    }) as never)
    expect(r1.status).toBe(200)

    // Attempt to go back to FirstPass11 — rejected as reuse.
    const r2 = await changePassword(asRequest('POST', '/api/auth/change-password', {
      cookie: u.cookie,
      body: { current_password: 'SecondPass22', new_password: 'FirstPass11' },
    }) as never)
    expect(r2.status).toBe(400)
    expect((await r2.json()).detail).toContain('password_reused')
  })
})

describe('login password-expiry flag', () => {
  it('flags an expired password and is false by default', async () => {
    const pwd = 'ExpiryPass11'
    const u = await mkLoginUser(pwd)
    // Backdate the password change far enough to expire under a 30-day max age.
    await ctx.pool.query(
      `UPDATE aaelink.users SET password_changed_at = $1 WHERE id = $2`,
      [Date.now() - 60 * 86_400_000, u.id]
    )
    await updatePasswordPolicy(ctx.pool, { max_age_days: 30 })
    invalidatePasswordPolicyCache()

    const res = await login(asRequest('POST', '/api/auth/login', { body: { login_id: u.email, password: pwd } }) as unknown as Request)
    expect(res.status).toBe(200)
    expect((await res.json()).password_expired).toBe(true)

    await resetPolicy()
    const res2 = await login(asRequest('POST', '/api/auth/login', { body: { login_id: u.email, password: pwd } }) as unknown as Request)
    expect((await res2.json()).password_expired).toBe(false)
  })
})
