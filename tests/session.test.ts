/**
 * AAELink — Session Constants Tests
 */
import { describe, it, expect } from 'vitest'
import { SESSION_COOKIE, sessionCookieSecure } from '@/lib/session'

describe('Session — SESSION_COOKIE constant', () => {
  it('is AAELINK_SESSION', () => {
    expect(SESSION_COOKIE).toBe('AAELINK_SESSION')
  })
})

describe('Session — sessionCookieSecure', () => {
  it('returns false in test env (no HTTPS URL)', () => {
    // process.env.NEXT_PUBLIC_APP_URL not set to https:// in test
    expect(sessionCookieSecure()).toBe(false)
  })

  it('returns true for https URL', () => {
    const orig = process.env.NEXT_PUBLIC_APP_URL
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.aaelink.com'
    expect(sessionCookieSecure()).toBe(true)
    process.env.NEXT_PUBLIC_APP_URL = orig
  })

  it('returns false for http URL', () => {
    const orig = process.env.NEXT_PUBLIC_APP_URL
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    expect(sessionCookieSecure()).toBe(false)
    process.env.NEXT_PUBLIC_APP_URL = orig
  })
})
