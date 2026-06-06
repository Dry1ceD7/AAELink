/**
 * Unit tests for the pure password-policy validator (Identity parity §27).
 *
 * No DB: validatePassword / isPasswordExpired / validatePolicyPatch are pure and
 * tested here as a matrix. DB-backed enforcement (change-password, admin CRUD,
 * history reuse) lives in __tests__/api/password-policy.test.ts.
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PASSWORD_POLICY,
  validatePassword,
  validatePolicyPatch,
  isPasswordExpired,
  type PasswordPolicy,
} from '@/lib/auth/passwordPolicy'

const base: PasswordPolicy = { ...DEFAULT_PASSWORD_POLICY }

describe('validatePassword — defaults', () => {
  it('accepts any 8+ char password under the default (permissive) policy', () => {
    expect(validatePassword(base, 'password')).toEqual([])
    expect(validatePassword(base, 'a'.repeat(8))).toEqual([])
  })
  it('rejects a too-short password', () => {
    expect(validatePassword(base, 'short')).toEqual(['too_short'])
    expect(validatePassword({ ...base, min_length: 12 }, 'password')).toEqual(['too_short'])
  })
})

describe('validatePassword — complexity matrix', () => {
  const strict: PasswordPolicy = {
    ...base,
    min_length: 8,
    require_upper: true,
    require_lower: true,
    require_digit: true,
    require_symbol: true,
  }
  it('accepts a fully-complex password', () => {
    expect(validatePassword(strict, 'Abcdef1!')).toEqual([])
  })
  it('flags each missing class independently', () => {
    expect(validatePassword(strict, 'abcdef1!')).toEqual(['require_upper'])
    expect(validatePassword(strict, 'ABCDEF1!')).toEqual(['require_lower'])
    expect(validatePassword(strict, 'Abcdefg!')).toEqual(['require_digit'])
    expect(validatePassword(strict, 'Abcdef12')).toEqual(['require_symbol'])
  })
  it('accumulates multiple violations', () => {
    const codes = validatePassword(strict, 'aaa')
    expect(codes).toContain('too_short')
    expect(codes).toContain('require_upper')
    expect(codes).toContain('require_digit')
    expect(codes).toContain('require_symbol')
  })
})

describe('validatePassword — disallow username/email', () => {
  const p: PasswordPolicy = { ...base, disallow_username_email: true }
  it('rejects a password containing the username', () => {
    expect(validatePassword(p, 'myalice123', { username: 'alice' })).toContain('contains_username')
  })
  it('rejects a password containing the email local-part', () => {
    expect(validatePassword(p, 'xxbobby99', { email: 'bobby@corp.com' })).toContain('contains_email')
  })
  it('ignores very short usernames to avoid false positives', () => {
    expect(validatePassword(p, 'abemorrison', { username: 'ab' })).toEqual([])
  })
  it('does nothing when the rule is off', () => {
    expect(validatePassword({ ...base }, 'myalice123', { username: 'alice' })).toEqual([])
  })
})

describe('validatePolicyPatch', () => {
  it('accepts a valid patch', () => {
    expect(validatePolicyPatch({ min_length: 12, require_upper: true, history_count: 5 })).toBeNull()
  })
  it('rejects out-of-range numbers', () => {
    expect(validatePolicyPatch({ min_length: 0 })?.field).toBe('min_length')
    expect(validatePolicyPatch({ max_age_days: -1 })?.field).toBe('max_age_days')
    expect(validatePolicyPatch({ history_count: 999 })?.field).toBe('history_count')
  })
  it('rejects non-boolean flags', () => {
    expect(validatePolicyPatch({ require_upper: 'yes' as never })?.field).toBe('require_upper')
  })
})

describe('isPasswordExpired', () => {
  const now = 1_000 * 86_400_000 // arbitrary fixed "now"
  it('never expires when max_age_days = 0', () => {
    expect(isPasswordExpired({ ...base, max_age_days: 0 }, now - 999 * 86_400_000, now)).toBe(false)
  })
  it('never expires a never-stamped (0) password', () => {
    expect(isPasswordExpired({ ...base, max_age_days: 30 }, 0, now)).toBe(false)
  })
  it('expires past the max age', () => {
    const p = { ...base, max_age_days: 30 }
    expect(isPasswordExpired(p, now - 31 * 86_400_000, now)).toBe(true)
    expect(isPasswordExpired(p, now - 29 * 86_400_000, now)).toBe(false)
  })
})
