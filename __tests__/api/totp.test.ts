/**
 * Unit tests for D2 RFC 6238 TOTP (lib/auth/totp.ts).
 *
 * Validated against the RFC 6238 Appendix B SHA-1 test vectors (secret
 * "12345678901234567890"). Pure — no database.
 */
import { describe, it, expect } from 'vitest'
import {
  base32Encode,
  base32Decode,
  generateTotpSecret,
  totpCode,
  verifyTotp,
  otpauthUri,
} from '@/lib/auth/totp'

// RFC 6238 test secret (ASCII) and its canonical base32 form.
const RFC_SECRET_ASCII = '12345678901234567890'
const RFC_SECRET_B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('base32', () => {
  it('encodes the RFC test secret to its canonical base32', () => {
    expect(base32Encode(Buffer.from(RFC_SECRET_ASCII))).toBe(RFC_SECRET_B32)
  })
  it('round-trips arbitrary bytes', () => {
    const b = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255])
    expect(base32Decode(base32Encode(b)).equals(b)).toBe(true)
  })
  it('decodes case-insensitively and ignores spaces', () => {
    expect(base32Decode('gezd gnbv'.toLowerCase()).equals(base32Decode('GEZDGNBV'))).toBe(true)
  })
})

describe('totpCode — RFC 6238 SHA-1 vectors', () => {
  it('matches the published 6-digit codes', () => {
    expect(totpCode(RFC_SECRET_B32, { timeMs: 59_000 })).toBe('287082')
    expect(totpCode(RFC_SECRET_B32, { timeMs: 1_111_111_109_000 })).toBe('081804')
    expect(totpCode(RFC_SECRET_B32, { timeMs: 1_234_567_890_000 })).toBe('005924')
    expect(totpCode(RFC_SECRET_B32, { timeMs: 2_000_000_000_000 })).toBe('279037')
  })
})

describe('verifyTotp', () => {
  const secret = RFC_SECRET_B32
  const now = 1_111_111_109_000

  it('accepts the current code', () => {
    expect(verifyTotp(secret, totpCode(secret, { timeMs: now }), { timeMs: now })).toBe(true)
  })
  it('tolerates ±1 step of drift', () => {
    const prev = totpCode(secret, { timeMs: now - 30_000 })
    const next = totpCode(secret, { timeMs: now + 30_000 })
    expect(verifyTotp(secret, prev, { timeMs: now })).toBe(true)
    expect(verifyTotp(secret, next, { timeMs: now })).toBe(true)
  })
  it('rejects a code outside the window', () => {
    const far = totpCode(secret, { timeMs: now - 5 * 30_000 })
    expect(verifyTotp(secret, far, { timeMs: now })).toBe(false)
  })
  it('rejects malformed input', () => {
    expect(verifyTotp(secret, '12345', { timeMs: now })).toBe(false)   // wrong length
    expect(verifyTotp(secret, 'abcdef', { timeMs: now })).toBe(false)  // non-digit
    expect(verifyTotp(secret, '', { timeMs: now })).toBe(false)
  })
})

describe('generateTotpSecret / otpauthUri', () => {
  it('produces a usable random secret that verifies its own code', () => {
    const secret = generateTotpSecret()
    expect(secret.length).toBeGreaterThanOrEqual(32)
    const t = 1_700_000_000_000
    expect(verifyTotp(secret, totpCode(secret, { timeMs: t }), { timeMs: t })).toBe(true)
  })
  it('builds an otpauth URI carrying the secret', () => {
    const uri = otpauthUri('JBSWY3DPEHPK3PXP', 'user@example.com')
    expect(uri.startsWith('otpauth://totp/')).toBe(true)
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP')
    expect(uri).toContain('issuer=AAELink')
  })
})
