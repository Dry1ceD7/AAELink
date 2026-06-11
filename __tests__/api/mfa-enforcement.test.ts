/**
 * Integration + unit tests for D2 MFA enforcement policy.
 *
 * Pure decision logic (mfaEnrollmentRequired, validateMfaPatch) is tested
 * directly; userHasActiveMfa and get/update run against a live Postgres. Login
 * enforcement is verified end-to-end through the public login handler.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, asRequest, TestContext } from '../helpers'
import { hashPassword } from '@/lib/auth/password'
import { POST as login } from '@/app/api/auth/login/route'
import {
  DEFAULT_MFA_POLICY,
  mfaEnrollmentRequired,
  validateMfaPatch,
  userHasActiveMfa,
  getMfaPolicy,
  updateMfaPolicy,
  invalidateMfaPolicyCache,
} from '@/lib/auth/mfaPolicy'

let ctx: TestContext
const userIds: string[] = []
const DAY = 86_400_000

async function mkUser(opts: { ageDays: number; admin?: boolean; password: string }): Promise<{ id: string; email: string }> {
  const id = randomUUID()
  const email = `mfa-${id.slice(0, 8)}@test.local`
  await ctx.pool.query(
    `INSERT INTO aaelink.users (id, username, email, password_hash, created_at, last_seen_at, platform_role)
     VALUES ($1, $2, $3, $4, $5, 0, $6)`,
    [id, `mfa-${id.slice(0, 8)}`, email, hashPassword(opts.password), Date.now() - opts.ageDays * DAY, opts.admin ? 'platform_admin' : 'employee']
  )
  userIds.push(id)
  return { id, email }
}

async function enrollMfa(uid: string): Promise<void> {
  await ctx.pool.query(
    `INSERT INTO aaelink.mfa_enrollments (id, user_id, method, secret_hash, is_active, is_verified, created_at, last_used_at)
     VALUES ($1, $2, 'totp', 'x', true, true, $3, 0)`,
    [randomUUID(), uid, Date.now()]
  )
}

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await updateMfaPolicy(ctx.pool, { ...DEFAULT_MFA_POLICY })
  invalidateMfaPolicyCache()
  await ctx.pool.query(`DELETE FROM aaelink.mfa_enrollments WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

describe('mfaEnrollmentRequired', () => {
  const past = { isAdmin: false, accountAgeMs: 30 * DAY }
  const fresh = { isAdmin: false, accountAgeMs: 1 * DAY }
  it('optional never requires', () => {
    expect(mfaEnrollmentRequired({ ...DEFAULT_MFA_POLICY, enforcement: 'optional' }, past)).toBe(false)
  })
  it('required enforces only past the grace window', () => {
    const p = { ...DEFAULT_MFA_POLICY, enforcement: 'required' as const, grace_period_days: 14 }
    expect(mfaEnrollmentRequired(p, past)).toBe(true)
    expect(mfaEnrollmentRequired(p, fresh)).toBe(false)
  })
  it('required_for_admins targets only admins', () => {
    const p = { ...DEFAULT_MFA_POLICY, enforcement: 'required_for_admins' as const, grace_period_days: 14 }
    expect(mfaEnrollmentRequired(p, { isAdmin: true, accountAgeMs: 30 * DAY })).toBe(true)
    expect(mfaEnrollmentRequired(p, { isAdmin: false, accountAgeMs: 30 * DAY })).toBe(false)
  })
})

describe('validateMfaPatch', () => {
  it('accepts valid, rejects bad enforcement and grace', () => {
    expect(validateMfaPatch({ enforcement: 'required', grace_period_days: 7 })).toBeNull()
    expect(validateMfaPatch({ enforcement: 'sometimes' as never })?.field).toBe('enforcement')
    expect(validateMfaPatch({ grace_period_days: 999 })?.field).toBe('grace_period_days')
  })
})

describe('userHasActiveMfa / policy persistence', () => {
  it('reflects active enrollment', async () => {
    const u = await mkUser({ ageDays: 1, password: 'x' })
    expect(await userHasActiveMfa(ctx.pool, u.id)).toBe(false)
    await enrollMfa(u.id)
    expect(await userHasActiveMfa(ctx.pool, u.id)).toBe(true)
  })

  it('persists and merges a policy patch', async () => {
    await ctx.pool.query(`DELETE FROM aaelink.system_config WHERE key = 'mfa_policy'`)
    invalidateMfaPolicyCache()
    expect((await getMfaPolicy(ctx.pool)).enforcement).toBe('optional')

    const updated = await updateMfaPolicy(ctx.pool, { enforcement: 'required', grace_period_days: 3 })
    expect(updated.enforcement).toBe('required')
    expect(updated.grace_period_days).toBe(3)
    expect(updated.remember_device_days).toBe(DEFAULT_MFA_POLICY.remember_device_days)
  })

  it('throws on an invalid update', async () => {
    await expect(updateMfaPolicy(ctx.pool, { grace_period_days: -1 })).rejects.toThrow()
  })
})

describe('login MFA enforcement', () => {
  it('blocks a past-grace unenrolled user when MFA is required', async () => {
    const pwd = 'login-mfa-pass-1'
    const u = await mkUser({ ageDays: 60, password: pwd })
    await updateMfaPolicy(ctx.pool, { enforcement: 'required', grace_period_days: 14 })

    const res = await login(asRequest('POST', '/api/auth/login', { body: { login_id: u.email, password: pwd } }) as unknown as Request)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('mfa_enrollment_required')
  })

  it('allows the same user once enrolled', async () => {
    const pwd = 'login-mfa-pass-2'
    const u = await mkUser({ ageDays: 60, password: pwd })
    await enrollMfa(u.id)
    await updateMfaPolicy(ctx.pool, { enforcement: 'required', grace_period_days: 14 })

    const res = await login(asRequest('POST', '/api/auth/login', { body: { login_id: u.email, password: pwd } }) as unknown as Request)
    expect(res.status).toBe(200)
  })

  it('allows a fresh (within-grace) unenrolled user', async () => {
    const pwd = 'login-mfa-pass-3'
    const u = await mkUser({ ageDays: 1, password: pwd })
    await updateMfaPolicy(ctx.pool, { enforcement: 'required', grace_period_days: 14 })

    const res = await login(asRequest('POST', '/api/auth/login', { body: { login_id: u.email, password: pwd } }) as unknown as Request)
    expect(res.status).toBe(200)
  })
})
