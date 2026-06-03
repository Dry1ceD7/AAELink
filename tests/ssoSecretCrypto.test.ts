/**
 * AAELink — SSO client-secret crypto tests (AES-256-GCM round-trip + tamper).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { encryptSecret, decryptSecret, ssoSecretKeyConfigured } from '@/lib/auth/ssoSecretCrypto'

describe('ssoSecretCrypto', () => {
  let orig: string | undefined
  beforeEach(() => {
    orig = process.env.AAELINK_SSO_SECRET_KEY
    process.env.AAELINK_SSO_SECRET_KEY = 'test-sso-key-please-rotate-0123456789'
  })
  afterEach(() => {
    if (orig === undefined) delete process.env.AAELINK_SSO_SECRET_KEY
    else process.env.AAELINK_SSO_SECRET_KEY = orig
  })

  it('round-trips a secret', () => {
    const enc = encryptSecret('super-secret-value')
    expect(enc).not.toContain('super-secret-value')
    expect(decryptSecret(enc)).toBe('super-secret-value')
  })

  it('produces different ciphertext each time (random IV)', () => {
    expect(encryptSecret('x')).not.toBe(encryptSecret('x'))
  })

  it('rejects tampered ciphertext via GCM auth tag', () => {
    const enc = encryptSecret('abc')
    const buf = Buffer.from(enc, 'base64')
    buf[buf.length - 1] ^= 0xff // flip a ciphertext byte
    expect(() => decryptSecret(buf.toString('base64'))).toThrow()
  })

  it('rejects malformed payloads', () => {
    expect(() => decryptSecret('short')).toThrow('sso_secret_malformed')
  })

  it('reports configured-key presence', () => {
    expect(ssoSecretKeyConfigured()).toBe(true)
    delete process.env.AAELINK_SSO_SECRET_KEY
    const sess = process.env.AAELINK_SESSION_SECRET
    delete process.env.AAELINK_SESSION_SECRET
    expect(ssoSecretKeyConfigured()).toBe(false)
    if (sess !== undefined) process.env.AAELINK_SESSION_SECRET = sess
  })

  it('throws when no key configured at all', () => {
    delete process.env.AAELINK_SSO_SECRET_KEY
    const sess = process.env.AAELINK_SESSION_SECRET
    delete process.env.AAELINK_SESSION_SECRET
    expect(() => encryptSecret('x')).toThrow('sso_secret_key_unset')
    if (sess !== undefined) process.env.AAELINK_SESSION_SECRET = sess
  })
})
