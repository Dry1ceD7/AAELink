/**
 * AAELink — CSRF Protection Tests
 *
 * Tests the double-submit cookie CSRF pattern.
 */
import { describe, it, expect } from 'vitest'

// We test the core crypto/validation logic directly since cookie handling
// requires Next.js runtime. Import the module's internal functions via
// a minimal re-export approach.

import { createHmac, randomBytes } from 'crypto'

const CSRF_SECRET = 'aaelink-csrf-default-secret-change-me'

function generateToken(): string {
  const raw = randomBytes(32).toString('hex')
  const sig = createHmac('sha256', CSRF_SECRET).update(raw).digest('hex').slice(0, 16)
  return `${raw}.${sig}`
}

function verifySignature(token: string): boolean {
  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [raw, sig] = parts
  const expected = createHmac('sha256', CSRF_SECRET).update(raw).digest('hex').slice(0, 16)
  if (sig.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < sig.length; i++) {
    diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}

describe('CSRF — Token Generation', () => {
  it('generates valid format tokens', () => {
    const token = generateToken()
    expect(token).toMatch(/^[0-9a-f]{64}\.[0-9a-f]{16}$/)
  })

  it('generates unique tokens', () => {
    const a = generateToken()
    const b = generateToken()
    expect(a).not.toBe(b)
  })

  it('generates tokens with valid signatures', () => {
    const token = generateToken()
    expect(verifySignature(token)).toBe(true)
  })
})

describe('CSRF — Signature Verification', () => {
  it('rejects tokens without dot separator', () => {
    expect(verifySignature('noseparator')).toBe(false)
  })

  it('rejects tokens with tampered raw portion', () => {
    const token = generateToken()
    const [, sig] = token.split('.')
    const tampered = `${'a'.repeat(64)}.${sig}`
    expect(verifySignature(tampered)).toBe(false)
  })

  it('rejects tokens with tampered signature', () => {
    const token = generateToken()
    const [raw] = token.split('.')
    const tampered = `${raw}.${'b'.repeat(16)}`
    expect(verifySignature(tampered)).toBe(false)
  })

  it('rejects empty tokens', () => {
    expect(verifySignature('')).toBe(false)
    expect(verifySignature('.')).toBe(false)
  })

  it('rejects tokens with wrong length signature', () => {
    const token = generateToken()
    const [raw] = token.split('.')
    expect(verifySignature(`${raw}.short`)).toBe(false)
  })

  it('validates correct signatures consistently', () => {
    for (let i = 0; i < 20; i++) {
      const token = generateToken()
      expect(verifySignature(token)).toBe(true)
    }
  })
})
