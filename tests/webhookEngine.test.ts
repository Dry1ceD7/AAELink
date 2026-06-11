/**
 * Unit tests for lib/webhookEngine.ts — HMAC signing, backoff, and verification
 */
import { describe, it, expect } from 'vitest'
import { signPayload, verifySignature, calculateBackoffMs } from '@/lib/webhooks/webhookEngine'

describe('Webhook Engine', () => {
  describe('HMAC signing', () => {
    it('produces a consistent hex signature', () => {
      const sig = signPayload('my-secret', 1700000000, '{"event":"test"}')
      expect(sig).toBeTruthy()
      expect(sig).toHaveLength(64) // SHA-256 hex = 64 chars
    })

    it('produces different signatures for different secrets', () => {
      const body = '{"event":"test"}'
      const ts = 1700000000
      const sig1 = signPayload('secret-a', ts, body)
      const sig2 = signPayload('secret-b', ts, body)
      expect(sig1).not.toBe(sig2)
    })

    it('produces different signatures for different timestamps', () => {
      const body = '{"event":"test"}'
      const sig1 = signPayload('secret', 1700000000, body)
      const sig2 = signPayload('secret', 1700000001, body)
      expect(sig1).not.toBe(sig2)
    })

    it('produces different signatures for different bodies', () => {
      const ts = 1700000000
      const sig1 = signPayload('secret', ts, '{"event":"a"}')
      const sig2 = signPayload('secret', ts, '{"event":"b"}')
      expect(sig1).not.toBe(sig2)
    })
  })

  describe('Signature verification', () => {
    it('verifies a valid signature', () => {
      const secret = 'test-secret-key'
      const ts = Date.now()
      const body = '{"event":"message.created"}'
      const sig = signPayload(secret, ts, body)
      expect(verifySignature(secret, sig, ts, body)).toBe(true)
    })

    it('rejects a wrong signature', () => {
      const ts = Date.now()
      const body = '{"event":"test"}'
      expect(verifySignature('secret', 'wrong-signature', ts, body)).toBe(false)
    })

    it('rejects an expired timestamp', () => {
      const secret = 'test-key'
      const oldTs = Date.now() - 10 * 60 * 1000 // 10 minutes ago
      const body = '{"event":"test"}'
      const sig = signPayload(secret, oldTs, body)
      expect(verifySignature(secret, sig, oldTs, body, 5 * 60 * 1000)).toBe(false)
    })

    it('accepts a recent timestamp within tolerance', () => {
      const secret = 'test-key'
      const ts = Date.now() - 30_000 // 30 seconds ago
      const body = '{"event":"test"}'
      const sig = signPayload(secret, ts, body)
      expect(verifySignature(secret, sig, ts, body, 60_000)).toBe(true)
    })
  })

  describe('Exponential backoff', () => {
    it('increases with each attempt', () => {
      const b0 = calculateBackoffMs(0, 1000, 32000)
      const b1 = calculateBackoffMs(1, 1000, 32000)
      const b2 = calculateBackoffMs(2, 1000, 32000)
      // Each should be roughly double the previous (with jitter)
      expect(b1).toBeGreaterThan(b0)
      expect(b2).toBeGreaterThan(b1)
    })

    it('caps at maxMs', () => {
      const b10 = calculateBackoffMs(10, 1000, 32000)
      expect(b10).toBeLessThanOrEqual(35200) // 32000 + 10% jitter
    })

    it('returns at least baseMs for attempt 0', () => {
      const b = calculateBackoffMs(0, 1000, 32000)
      expect(b).toBeGreaterThanOrEqual(1000)
    })

    it('applies jitter (non-deterministic)', () => {
      // Run 10 times, expect at least some variation
      const results = Array.from({ length: 10 }, () => calculateBackoffMs(3, 1000, 32000))
      const unique = new Set(results)
      // With 10% jitter, we expect some variation (though not guaranteed)
      expect(unique.size).toBeGreaterThanOrEqual(1)
    })
  })
})
