/**
 * Integration + unit tests for D2 session-duration policy.
 *
 * Pure helpers (sessionTtlMs, isIdleExpired, validatePolicyPatch) are tested
 * directly; getSessionPolicy/updateSessionPolicy run against a live Postgres.
 * The route (app/api/admin/session-policy) is a thin admin wrapper over the lib.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestContext, createTestUser, TestContext, TestUser } from '../helpers'
import { readSessionUserIdFromCookieHeader } from '@/lib/auth/session'
import {
  DEFAULT_SESSION_POLICY,
  sessionTtlMs,
  isIdleExpired,
  validatePolicyPatch,
  getSessionPolicy,
  updateSessionPolicy,
  invalidateSessionPolicyCache,
} from '@/lib/auth/sessionPolicy'

let ctx: TestContext
let user: TestUser
const userIds: string[] = []

beforeAll(async () => {
  ctx = await createTestContext()
  user = await createTestUser(ctx.pool, { role: 'employee' })
  userIds.push(user.id)
})

afterAll(async () => {
  // Restore defaults so this suite does not leak policy into other suites' logins.
  await updateSessionPolicy(ctx.pool, { ...DEFAULT_SESSION_POLICY })
  invalidateSessionPolicyCache()
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE user_id = ANY($1)`, [userIds])
  await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
})

beforeEach(() => invalidateSessionPolicyCache())

describe('sessionTtlMs', () => {
  it('selects the per-device TTL and clamps to >= 1h', () => {
    const p = { ...DEFAULT_SESSION_POLICY, web_session_ttl_hours: 24, desktop_session_ttl_hours: 720, mobile_session_ttl_hours: 12 }
    expect(sessionTtlMs(p, 'web')).toBe(24 * 3600_000)
    expect(sessionTtlMs(p, 'desktop')).toBe(720 * 3600_000)
    expect(sessionTtlMs(p, 'mobile')).toBe(12 * 3600_000)
    expect(sessionTtlMs({ ...p, web_session_ttl_hours: 0 }, 'web')).toBe(3600_000)
  })

  it('defaults preserve the prior 30-day session', () => {
    expect(sessionTtlMs(DEFAULT_SESSION_POLICY, 'web')).toBe(720 * 3600_000)
  })
})

describe('isIdleExpired', () => {
  const now = 1_000_000_000_000
  it('never expires when idle enforcement is disabled', () => {
    const p = { ...DEFAULT_SESSION_POLICY, idle_timeout_enabled: false, idle_timeout_minutes: 1 }
    expect(isIdleExpired(p, now - 9_999_999, now)).toBe(false)
  })
  it('expires past the limit when enabled', () => {
    const p = { ...DEFAULT_SESSION_POLICY, idle_timeout_enabled: true, idle_timeout_minutes: 60 }
    expect(isIdleExpired(p, now - 61 * 60_000, now)).toBe(true)
    expect(isIdleExpired(p, now - 59 * 60_000, now)).toBe(false)
  })
  it('falls back to createdAt when last-active is 0, and never on a fresh session', () => {
    const p = { ...DEFAULT_SESSION_POLICY, idle_timeout_enabled: true, idle_timeout_minutes: 60 }
    expect(isIdleExpired(p, 0, now, now - 61 * 60_000)).toBe(true)
    expect(isIdleExpired(p, 0, now, now)).toBe(false)
    expect(isIdleExpired(p, 0, now, 0)).toBe(false)
  })
})

describe('validatePolicyPatch', () => {
  it('accepts an in-range patch', () => {
    expect(validatePolicyPatch({ web_session_ttl_hours: 24, idle_timeout_minutes: 30 })).toBeNull()
  })
  it('rejects out-of-range TTL, sessions, and idle', () => {
    expect(validatePolicyPatch({ web_session_ttl_hours: 0 })?.field).toBe('web_session_ttl_hours')
    expect(validatePolicyPatch({ web_session_ttl_hours: 9000 })?.field).toBe('web_session_ttl_hours')
    expect(validatePolicyPatch({ max_sessions_per_user: 0 })?.field).toBe('max_sessions_per_user')
    expect(validatePolicyPatch({ idle_timeout_minutes: 1 })?.field).toBe('idle_timeout_minutes')
  })
})

describe('getSessionPolicy / updateSessionPolicy', () => {
  it('returns defaults when nothing is stored', async () => {
    await ctx.pool.query(`DELETE FROM aaelink.system_config WHERE key = 'session_policy'`)
    invalidateSessionPolicyCache()
    const p = await getSessionPolicy(ctx.pool)
    expect(p.web_session_ttl_hours).toBe(DEFAULT_SESSION_POLICY.web_session_ttl_hours)
    expect(p.idle_timeout_enabled).toBe(false)
  })

  it('persists and merges a patch, leaving other fields at defaults', async () => {
    const updated = await updateSessionPolicy(ctx.pool, { web_session_ttl_hours: 8, idle_timeout_enabled: true })
    expect(updated.web_session_ttl_hours).toBe(8)
    expect(updated.idle_timeout_enabled).toBe(true)
    expect(updated.desktop_session_ttl_hours).toBe(DEFAULT_SESSION_POLICY.desktop_session_ttl_hours)

    invalidateSessionPolicyCache()
    const reread = await getSessionPolicy(ctx.pool)
    expect(reread.web_session_ttl_hours).toBe(8)
    expect(reread.idle_timeout_enabled).toBe(true)
  })

  it('throws on an out-of-range update', async () => {
    await expect(updateSessionPolicy(ctx.pool, { idle_timeout_minutes: 1 })).rejects.toThrow()
  })
})

describe('readSessionUserIdFromCookieHeader idle enforcement', () => {
  it('resolves a fresh session under default (idle disabled) policy', async () => {
    await updateSessionPolicy(ctx.pool, { ...DEFAULT_SESSION_POLICY })
    expect(await readSessionUserIdFromCookieHeader(user.sessionCookie)).toBe(user.id)
  })

  it('returns null when the session has gone idle past an enabled limit', async () => {
    // Backdate activity well beyond a 5-minute idle window.
    const stale = Date.now() - 60 * 60_000
    await ctx.pool.query(
      `UPDATE aaelink.sessions SET last_active_at = $1, created_at = $1 WHERE id = $2`,
      [stale, user.sessionId]
    )
    await updateSessionPolicy(ctx.pool, { idle_timeout_enabled: true, idle_timeout_minutes: 5 })
    expect(await readSessionUserIdFromCookieHeader(user.sessionCookie)).toBeNull()

    // Disabling enforcement makes the same session valid again.
    await updateSessionPolicy(ctx.pool, { idle_timeout_enabled: false })
    expect(await readSessionUserIdFromCookieHeader(user.sessionCookie)).toBe(user.id)
  })
})
