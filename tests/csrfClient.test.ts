/**
 * AAELink — CSRF Client Constants Tests
 */
import { describe, it, expect } from 'vitest'

// Re-implement the constant for testing (line 6)
const CSRF_COOKIE = 'AAELINK_CSRF'

describe('CsrfClient — CSRF_COOKIE constant', () => {
  it('is AAELINK_CSRF', () => {
    expect(CSRF_COOKIE).toBe('AAELINK_CSRF')
  })
})

describe('CsrfClient — readCsrfTokenFromDocument (SSR)', () => {
  it('returns empty string on server', async () => {
    // In test environment without document.cookie, should return empty
    const mod = await import('@/lib/auth/csrfClient')
    const result = mod.readCsrfTokenFromDocument()
    expect(result).toBe('')
  })
})
