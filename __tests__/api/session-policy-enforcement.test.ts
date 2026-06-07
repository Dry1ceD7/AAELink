/**
 * Integration tests for D2 session-policy ENFORCEMENT (Identity 26).
 *
 * Five formerly defined-only fields are now wired and verified end-to-end:
 *   - max_sessions_per_user  → login evicts the oldest session beyond the cap
 *   - single_session_mode    → login revokes all other sessions of the user
 *   - force_reauth_hours     → readSessionUserId rejects a too-old session
 *   - revoke_on_password_change → change-password kills the user's other sessions
 *   - require_mfa_for_admin  → platform-admin without MFA is denied at login
 *
 * Everything runs through the real route handlers against a live Postgres.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, asRequest, TestContext } from '../helpers'
import { hashPassword } from '@/lib/auth/password'
import { POST as login } from '@/app/api/auth/login/route'
import { POST as changePassword } from '@/app/api/auth/change-password/route'
import { readSessionUserIdFromCookieHeader } from '@/lib/auth/session'
import {
  DEFAULT_SESSION_POLICY,
  updateSessionPolicy,
  invalidateSessionPolicyCache,
} from '@/lib/auth/sessionPolicy'
import {
  DEFAULT_MFA_POLICY,
  updateMfaPolicy,
  invalidateMfaPolicyCache,
} from '@/lib/auth/mfaPolicy'

let ctx: TestContext
const userIds: string[] = []
const HOUR = 3600_000

async function mkUser(opts: { password: string; admin?: boolean }): Promise<{ id: string; email: string }> {
  const id = randomUUID()
  const email = `spe-${id.slice(0, 8)}@test.local`
  await ctx.pool.query(
    `INSERT INTO aaelink.users (id, username, email, password_hash, created_at, last_seen_at, platform_role)
     VALUES ($1, $2, $3, $4, $5, 0, $6)`,
    [id, `spe-${id.slice(0, 8)}`, email, hashPassword(opts.password), Date.now() - 60 * 86_400_000, opts.admin ? 'super_admin' : 'employee']
  )
  userIds.push(id)
  return { id, email }
}

/** Seed an existing (pre-login) session, optionally backdated. Returns its id. */
async function seedSession(uid: string, ageMs = 0): Promise<string> {
  const id = randomUUID()
  const now = Date.now()
  await ctx.pool.query(
    `INSERT INTO aaelink.sessions (id, user_id, expires_at, user_agent, ip_address, created_at, last_active_at)
     VALUES ($1, $2, $3, 'seed', '127.0.0.1', $4, $4)`,
    [id, uid, now + 30 * 24 * HOUR, now - ageMs]
  )
  return id
}

async function enrollMfa(uid: string): Promise<void> {
  await ctx.pool.query(
    `INSERT INTO aaelink.mfa_enrollments (id, user_id, method, secret_hash, is_active, is_verified, created_at, last_used_at)
     VALUES ($1, $2, 'totp', 'x', true, true, $3, 0)`,
    [randomUUID(), uid, Date.now()]
  )
}

async function sessionCount(uid: string): Promise<number> {
  const { rows } = await ctx.pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM aaelink.sessions WHERE user_id = $1`, [uid]
  )
  return Number(rows[0].n)
}

function loginReq(email: string, password: string) {
  return asRequest('POST', '/api/auth/login', { body: { login_id: email, password } }) as unknown as Request
}

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await updateSessionPolicy(ctx.pool, { ...DEFAULT_SESSION_POLICY })
  invalidateSessionPolicyCache()
  await updateMfaPolicy(ctx.pool, { ...DEFAULT_MFA_POLICY })
  invalidateMfaPolicyCache()
  await ctx.pool.query(`DELETE FROM aaelink.mfa_enrollments WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

beforeEach(async () => {
  await updateSessionPolicy(ctx.pool, { ...DEFAULT_SESSION_POLICY })
  invalidateSessionPolicyCache()
  // Keep the global MFA policy at 'optional' so require_mfa_for_admin is the only
  // MFA gate under test, independent of whatever other suites left behind.
  await updateMfaPolicy(ctx.pool, { ...DEFAULT_MFA_POLICY })
  invalidateMfaPolicyCache()
})

describe('max_sessions_per_user (login)', () => {
  it('evicts the oldest session when login would exceed the cap', async () => {
    const pwd = 'cap-pass-123'
    const u = await mkUser({ password: pwd })
    // Cap = 2, pre-seed 2 sessions (oldest + middle); login creates the 3rd.
    await updateSessionPolicy(ctx.pool, { max_sessions_per_user: 2 })
    invalidateSessionPolicyCache()
    const oldest = await seedSession(u.id, 5 * HOUR)
    await seedSession(u.id, 2 * HOUR)

    const res = await login(loginReq(u.email, pwd))
    expect(res.status).toBe(200)

    expect(await sessionCount(u.id)).toBe(2)
    const { rows } = await ctx.pool.query(`SELECT id FROM aaelink.sessions WHERE id = $1`, [oldest])
    expect(rows.length).toBe(0) // oldest evicted
  })
})

describe('single_session_mode (login)', () => {
  it('revokes all other sessions, leaving only the just-created one', async () => {
    const pwd = 'single-pass-123'
    const u = await mkUser({ password: pwd })
    await updateSessionPolicy(ctx.pool, { single_session_mode: true })
    invalidateSessionPolicyCache()
    await seedSession(u.id, 3 * HOUR)
    await seedSession(u.id, 1 * HOUR)

    const res = await login(loginReq(u.email, pwd))
    expect(res.status).toBe(200)
    expect(await sessionCount(u.id)).toBe(1)
  })
})

describe('force_reauth_hours (session validation)', () => {
  it('rejects a session older than the window regardless of activity', async () => {
    const u = await mkUser({ password: 'x' })
    const sid = await seedSession(u.id, 0)
    // Make it valid first under the default 168h window (fresh session).
    expect(await readSessionUserIdFromCookieHeader(`AAELINK_SESSION=${sid}`)).toBe(u.id)

    // Backdate created_at beyond a 1h force-reauth window; last_active_at recent
    // so this is NOT an idle expiry — it is the auth-age gate.
    const now = Date.now()
    await ctx.pool.query(
      `UPDATE aaelink.sessions SET created_at = $1, last_active_at = $2 WHERE id = $3`,
      [now - 2 * HOUR, now, sid]
    )
    await updateSessionPolicy(ctx.pool, { force_reauth_hours: 1 })
    invalidateSessionPolicyCache()
    expect(await readSessionUserIdFromCookieHeader(`AAELINK_SESSION=${sid}`)).toBeNull()

    // Widening the window makes the same session valid again.
    await updateSessionPolicy(ctx.pool, { force_reauth_hours: 720 })
    invalidateSessionPolicyCache()
    expect(await readSessionUserIdFromCookieHeader(`AAELINK_SESSION=${sid}`)).toBe(u.id)
  })
})

describe('revoke_on_password_change (change-password)', () => {
  it('revokes every other session, keeps the caller session', async () => {
    const pwd = 'pwc-pass-old-1'
    const u = await mkUser({ password: pwd })
    const caller = await seedSession(u.id, 0)
    await seedSession(u.id, 1 * HOUR)
    await seedSession(u.id, 2 * HOUR)
    expect(await sessionCount(u.id)).toBe(3)

    await updateSessionPolicy(ctx.pool, { revoke_on_password_change: true })
    invalidateSessionPolicyCache()

    const req = asRequest('POST', '/api/auth/change-password', {
      cookie: `AAELINK_SESSION=${caller}`,
      body: { current_password: pwd, new_password: 'pwc-pass-new-2' },
    }) as unknown as Request
    const res = await changePassword(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.revoked_sessions).toBe(2)

    expect(await sessionCount(u.id)).toBe(1)
    const { rows } = await ctx.pool.query(`SELECT id FROM aaelink.sessions WHERE id = $1`, [caller])
    expect(rows.length).toBe(1) // caller survives
  })

  it('keeps other sessions when the policy is off', async () => {
    const pwd = 'pwc-pass-old-3'
    const u = await mkUser({ password: pwd })
    const caller = await seedSession(u.id, 0)
    await seedSession(u.id, 1 * HOUR)

    await updateSessionPolicy(ctx.pool, { revoke_on_password_change: false })
    invalidateSessionPolicyCache()

    const req = asRequest('POST', '/api/auth/change-password', {
      cookie: `AAELINK_SESSION=${caller}`,
      body: { current_password: pwd, new_password: 'pwc-pass-new-4' },
    }) as unknown as Request
    const res = await changePassword(req)
    expect(res.status).toBe(200)
    expect((await res.json()).revoked_sessions).toBe(0)
    expect(await sessionCount(u.id)).toBe(2)
  })
})

describe('require_mfa_for_admin (login)', () => {
  it('denies a platform-admin without MFA when the session policy requires it', async () => {
    const pwd = 'admin-mfa-pass-1'
    const u = await mkUser({ password: pwd, admin: true })
    await updateSessionPolicy(ctx.pool, { require_mfa_for_admin: true })
    invalidateSessionPolicyCache()

    const res = await login(loginReq(u.email, pwd))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('mfa_enrollment_required')
  })

  it('allows the admin once MFA is enrolled', async () => {
    const pwd = 'admin-mfa-pass-2'
    const u = await mkUser({ password: pwd, admin: true })
    await enrollMfa(u.id)
    await updateSessionPolicy(ctx.pool, { require_mfa_for_admin: true })
    invalidateSessionPolicyCache()

    const res = await login(loginReq(u.email, pwd))
    expect(res.status).toBe(200)
  })

  it('does not affect non-admin users', async () => {
    const pwd = 'admin-mfa-pass-3'
    const u = await mkUser({ password: pwd, admin: false })
    await updateSessionPolicy(ctx.pool, { require_mfa_for_admin: true })
    invalidateSessionPolicyCache()

    const res = await login(loginReq(u.email, pwd))
    expect(res.status).toBe(200)
  })
})
