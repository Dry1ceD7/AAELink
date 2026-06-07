/**
 * Integration tests for POST /api/admin/users/deactivate.
 *
 * Covers the converged deactivate/reactivate flow:
 *   - deactivate → login blocked (account_deactivated) + sessions revoked
 *   - reactivate → login works again
 *   - cannot deactivate yourself (409)
 *   - non-admin caller is forbidden (403)
 *   - only a super_admin may deactivate another super_admin (403 otherwise)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext,
  createTestUser,
  asRequest,
  parseResponse,
  type TestContext,
  type TestUser,
} from '../helpers'
import { hashPassword } from '@/lib/auth/password'
import { POST as deactivate } from '@/app/api/admin/users/deactivate/route'
import { POST as login } from '@/app/api/auth/login/route'

let ctx: TestContext
const createdIds: string[] = []
const PASSWORD = 'Sup3rSecret!Pass'

/** Create a user with a real (login-capable) password hash + one active session. */
async function mkLoginUser(role = 'employee'): Promise<{ id: string; username: string; sessionId: string }> {
  const id = randomUUID()
  const username = `dz_${id.slice(0, 8)}`
  const now = Date.now()
  await ctx.pool.query(
    `INSERT INTO aaelink.users (id, username, email, password_hash, nickname, first_name, platform_role, department, created_at, password_changed_at, scim_active)
     VALUES ($1, $2, $3, $4, '', '', $5, '', $6, $6, true)`,
    [id, username, `${username}@aaelink.test`, hashPassword(PASSWORD), role, now]
  )
  const sessionId = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.sessions (id, user_id, expires_at, user_agent, ip_address, created_at, last_active_at)
     VALUES ($1, $2, $3, 'vitest', '127.0.0.1', $4, $4)`,
    [sessionId, id, now + 86_400_000, now]
  )
  createdIds.push(id)
  return { id, username, sessionId }
}

async function attemptLogin(login_id: string) {
  const res = await login(asRequest('POST', '/api/auth/login', { body: { login_id, password: PASSWORD } }) as unknown as Request)
  return res
}

async function activeSessions(userId: string): Promise<number> {
  const { rows } = await ctx.pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM aaelink.sessions WHERE user_id = $1`, [userId]
  )
  return Number(rows[0]?.n || 0)
}

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  if (createdIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [createdIds])
    await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [createdIds])
  }
})

describe('POST /api/admin/users/deactivate', () => {
  it('deactivate blocks login and revokes sessions; reactivate restores login', async () => {
    const admin: TestUser = await createTestUser(ctx.pool, { role: 'super_admin' })
    createdIds.push(admin.id)
    const target = await mkLoginUser()

    // Login works before deactivation.
    expect((await attemptLogin(target.username)).status).toBe(200)

    const deRes = await deactivate(asRequest('POST', '/api/admin/users/deactivate', {
      cookie: admin.sessionCookie,
      body: { user_id: target.id, active: false },
    }) as unknown as Request)
    expect(deRes.status).toBe(200)
    expect(await activeSessions(target.id)).toBe(0)

    // Login now blocked.
    const blocked = await attemptLogin(target.username)
    expect(blocked.status).toBe(403)
    expect((await parseResponse<{ error: string }>(blocked)).error).toBe('account_deactivated')

    // Reactivate → login works again.
    const reRes = await deactivate(asRequest('POST', '/api/admin/users/deactivate', {
      cookie: admin.sessionCookie,
      body: { user_id: target.id, active: true },
    }) as unknown as Request)
    expect(reRes.status).toBe(200)
    expect((await attemptLogin(target.username)).status).toBe(200)
  })

  it('cannot deactivate yourself', async () => {
    const admin: TestUser = await createTestUser(ctx.pool, { role: 'super_admin' })
    createdIds.push(admin.id)
    const res = await deactivate(asRequest('POST', '/api/admin/users/deactivate', {
      cookie: admin.sessionCookie,
      body: { user_id: admin.id, active: false },
    }) as unknown as Request)
    expect(res.status).toBe(409)
    expect((await parseResponse<{ error: string }>(res)).error).toBe('cannot_deactivate_self')
  })

  it('non-admin caller is forbidden', async () => {
    const member: TestUser = await createTestUser(ctx.pool, { role: 'employee' })
    createdIds.push(member.id)
    const target = await mkLoginUser()
    const res = await deactivate(asRequest('POST', '/api/admin/users/deactivate', {
      cookie: member.sessionCookie,
      body: { user_id: target.id, active: false },
    }) as unknown as Request)
    expect(res.status).toBe(403)
  })

  it('it_admin cannot deactivate a super_admin', async () => {
    const itAdmin: TestUser = await createTestUser(ctx.pool, { role: 'it_admin' })
    createdIds.push(itAdmin.id)
    const superTarget = await mkLoginUser('super_admin')
    const res = await deactivate(asRequest('POST', '/api/admin/users/deactivate', {
      cookie: itAdmin.sessionCookie,
      body: { user_id: superTarget.id, active: false },
    }) as unknown as Request)
    expect(res.status).toBe(403)
    expect((await parseResponse<{ error: string }>(res)).error).toBe('forbidden_target')
    // Super admin remains active and able to log in.
    expect(await activeSessions(superTarget.id)).toBe(1)
  })

  it('super_admin can deactivate another super_admin', async () => {
    const admin: TestUser = await createTestUser(ctx.pool, { role: 'super_admin' })
    createdIds.push(admin.id)
    const superTarget = await mkLoginUser('super_admin')
    const res = await deactivate(asRequest('POST', '/api/admin/users/deactivate', {
      cookie: admin.sessionCookie,
      body: { user_id: superTarget.id, active: false },
    }) as unknown as Request)
    expect(res.status).toBe(200)
    expect(await activeSessions(superTarget.id)).toBe(0)
  })

  it('rejects missing active flag and missing user_id', async () => {
    const admin: TestUser = await createTestUser(ctx.pool, { role: 'super_admin' })
    createdIds.push(admin.id)
    const noActive = await deactivate(asRequest('POST', '/api/admin/users/deactivate', {
      cookie: admin.sessionCookie,
      body: { user_id: 'whatever' },
    }) as unknown as Request)
    expect(noActive.status).toBe(400)
    const noId = await deactivate(asRequest('POST', '/api/admin/users/deactivate', {
      cookie: admin.sessionCookie,
      body: { active: false },
    }) as unknown as Request)
    expect(noId.status).toBe(400)
  })
})
