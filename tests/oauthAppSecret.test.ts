import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import {
  hashAppSecret,
  isHashedAppSecret,
  verifyAppSecret,
} from '@/lib/auth/oauthAppSecret'

describe('oauthAppSecret.hashAppSecret', () => {
  it('produces a prefixed sha256 hex digest matching the repo openid scheme', () => {
    const secret = 'super-secret-value'
    const hashed = hashAppSecret(secret)
    const rawHex = createHash('sha256').update(secret, 'utf8').digest('hex')
    expect(hashed).toBe(`sha256:${rawHex}`)
    expect(isHashedAppSecret(hashed)).toBe(true)
  })

  it('is deterministic and differs per input', () => {
    expect(hashAppSecret('a')).toBe(hashAppSecret('a'))
    expect(hashAppSecret('a')).not.toBe(hashAppSecret('b'))
  })
})

describe('oauthAppSecret.isHashedAppSecret', () => {
  it('treats plaintext (no prefix) as not hashed', () => {
    expect(isHashedAppSecret('super-secret-value')).toBe(false)
    expect(isHashedAppSecret('')).toBe(false)
    expect(isHashedAppSecret(hashAppSecret('x'))).toBe(true)
  })
})

describe('oauthAppSecret.verifyAppSecret', () => {
  it('verifies against a hashed stored value without requesting upgrade', () => {
    const stored = hashAppSecret('correct-horse')
    expect(verifyAppSecret('correct-horse', stored)).toEqual({ ok: true, needsUpgrade: false })
    expect(verifyAppSecret('wrong', stored)).toEqual({ ok: false, needsUpgrade: false })
  })

  it('verifies a legacy plaintext stored value and flags it for lazy upgrade', () => {
    const stored = 'legacy-plaintext-secret'
    expect(verifyAppSecret('legacy-plaintext-secret', stored)).toEqual({ ok: true, needsUpgrade: true })
    // A wrong secret against plaintext must not request an upgrade.
    expect(verifyAppSecret('nope', stored)).toEqual({ ok: false, needsUpgrade: false })
  })

  it('rejects the realistic attack shape: a secret of the SAME length, one differing char', () => {
    // The most common online-guess shape is a correctly-shaped secret with a
    // single wrong character — this exercises the equal-length digest compare,
    // not the length-mismatch guard.
    const secret = 'correct-horse-battery'
    const oneOff = 'correct-horse-batterX' // same length, last char differs
    expect(secret.length).toBe(oneOff.length)
    expect(verifyAppSecret(oneOff, hashAppSecret(secret))).toEqual({ ok: false, needsUpgrade: false })
    // Same shape against a legacy plaintext row.
    expect(verifyAppSecret(oneOff, secret)).toEqual({ ok: false, needsUpgrade: false })
  })

  it('rejects when presented secret length differs (no crash)', () => {
    expect(verifyAppSecret('short', hashAppSecret('a-much-longer-secret'))).toEqual({ ok: false, needsUpgrade: false })
    expect(verifyAppSecret('short', 'a-much-longer-plaintext')).toEqual({ ok: false, needsUpgrade: false })
  })

  it('compares fixed-width 71-char digests for ANY input, so the compare operands are always equal length', () => {
    // Both the hashed and (post-fix) plaintext branches feed hashAppSecret()
    // output into the compare, so the length-mismatch guard in constantTimeEqual
    // can never fire for either real branch — the timing channel about secret
    // length is closed. hashAppSecret is always 'sha256:' + 64 hex = 71 chars.
    expect(hashAppSecret('').length).toBe(71)
    expect(hashAppSecret('x').length).toBe(71)
    expect(hashAppSecret('a-much-longer-secret-value-that-is-quite-long').length).toBe(71)
  })
})
