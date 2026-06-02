/**
 * AAELink — Support Session Constants Tests
 */
import { describe, it, expect } from 'vitest'
import { SUPPORT_SESSION_COOKIE, supportSessionCookieOptions } from '@/lib/auth/supportSession'

describe('SupportSession — SUPPORT_SESSION_COOKIE', () => {
  it('is AAELINK_SUPPORT_SESSION', () => {
    expect(SUPPORT_SESSION_COOKIE).toBe('AAELINK_SUPPORT_SESSION')
  })
})

describe('SupportSession — supportSessionCookieOptions', () => {
  it('returns httpOnly true', () => {
    const opts = supportSessionCookieOptions()
    expect(opts.httpOnly).toBe(true)
  })

  it('returns sameSite lax', () => {
    const opts = supportSessionCookieOptions()
    expect(opts.sameSite).toBe('lax')
  })

  it('returns path /', () => {
    const opts = supportSessionCookieOptions()
    expect(opts.path).toBe('/')
  })

  it('maxAge is 8 hours in seconds', () => {
    const opts = supportSessionCookieOptions()
    expect(opts.maxAge).toBe(8 * 60 * 60)
  })
})
