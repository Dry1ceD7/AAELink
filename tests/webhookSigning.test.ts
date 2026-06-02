/**
 * AAELink — Webhook Signing Tests
 *
 * Validates HMAC-SHA256 signing, verification, replay protection,
 * and edge cases.
 */
import { describe, it, expect } from 'vitest'
import {
  signPayload,
  verifySignature,
  generateSigningSecret,
  SIGNATURE_VERSION,
} from '@/lib/webhooks/webhookSigning'

const SECRET = 'whsec_test_secret_key_for_unit_tests'

describe('Webhook Signing — Sign', () => {
  it('produces a valid v0 signature', () => {
    const body = JSON.stringify({ event: 'message.created', data: { id: '123' } })
    const result = signPayload(SECRET, body, 1700000000)

    expect(result.signature).toMatch(/^v0=[0-9a-f]{64}$/)
    expect(result.timestamp).toBe(1700000000)
    expect(result.headers['x-aaelink-signature']).toBe(result.signature)
    expect(result.headers['x-aaelink-timestamp']).toBe('1700000000')
  })

  it('produces different signatures for different bodies', () => {
    const ts = 1700000000
    const sig1 = signPayload(SECRET, '{"a":1}', ts)
    const sig2 = signPayload(SECRET, '{"a":2}', ts)
    expect(sig1.signature).not.toBe(sig2.signature)
  })

  it('produces different signatures for different timestamps', () => {
    const body = '{"a":1}'
    const sig1 = signPayload(SECRET, body, 1700000000)
    const sig2 = signPayload(SECRET, body, 1700000001)
    expect(sig1.signature).not.toBe(sig2.signature)
  })

  it('produces different signatures for different secrets', () => {
    const body = '{"a":1}'
    const ts = 1700000000
    const sig1 = signPayload('secret1', body, ts)
    const sig2 = signPayload('secret2', body, ts)
    expect(sig1.signature).not.toBe(sig2.signature)
  })

  it('uses current timestamp when none provided', () => {
    const result = signPayload(SECRET, '{}')
    const now = Math.floor(Date.now() / 1000)
    expect(Math.abs(result.timestamp - now)).toBeLessThan(2)
  })
})

describe('Webhook Signing — Verify', () => {
  it('verifies a valid signature', () => {
    const body = '{"event":"test"}'
    const ts = Math.floor(Date.now() / 1000)
    const { signature } = signPayload(SECRET, body, ts)

    const result = verifySignature(SECRET, body, signature, ts)
    expect(result.valid).toBe(true)
    expect(result.reason).toBe('ok')
  })

  it('rejects a tampered body', () => {
    const ts = Math.floor(Date.now() / 1000)
    const { signature } = signPayload(SECRET, '{"a":1}', ts)

    const result = verifySignature(SECRET, '{"a":2}', signature, ts)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('signature_mismatch')
  })

  it('rejects an expired timestamp', () => {
    const oldTs = Math.floor(Date.now() / 1000) - 600 // 10 min ago
    const { signature } = signPayload(SECRET, '{}', oldTs)

    const result = verifySignature(SECRET, '{}', signature, oldTs)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('timestamp_expired')
  })

  it('rejects invalid timestamp format', () => {
    const result = verifySignature(SECRET, '{}', 'v0=abc', 'not-a-number')
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('invalid_timestamp')
  })

  it('rejects invalid signature format', () => {
    const ts = Math.floor(Date.now() / 1000)
    const result = verifySignature(SECRET, '{}', 'invalid_format', ts)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('invalid_signature_format')
  })

  it('rejects wrong secret', () => {
    const ts = Math.floor(Date.now() / 1000)
    const { signature } = signPayload(SECRET, '{}', ts)

    const result = verifySignature('wrong_secret', '{}', signature, ts)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('signature_mismatch')
  })

  it('accepts string timestamp', () => {
    const ts = Math.floor(Date.now() / 1000)
    const { signature } = signPayload(SECRET, '{"x":1}', ts)

    const result = verifySignature(SECRET, '{"x":1}', signature, String(ts))
    expect(result.valid).toBe(true)
  })
})

describe('Webhook Signing — Secret Generation', () => {
  it('generates a secret with whsec_ prefix', () => {
    const secret = generateSigningSecret()
    expect(secret).toMatch(/^whsec_[0-9a-f]{64}$/)
  })

  it('generates unique secrets', () => {
    const a = generateSigningSecret()
    const b = generateSigningSecret()
    expect(a).not.toBe(b)
  })

  it('respects custom length', () => {
    const secret = generateSigningSecret(16)
    expect(secret).toMatch(/^whsec_[0-9a-f]{32}$/)
  })
})
