/**
 * AAELink — Rate Limiter Tests
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { getRateLimiter } from '@/lib/api/rateLimiter'

describe('RateLimiter', () => {
  let limiter: ReturnType<typeof getRateLimiter>

  beforeEach(() => {
    // Each test gets the module singleton — but we test distinct keys
    limiter = getRateLimiter()
  })

  it('allows requests under limit', () => {
    const key = `test:under:${Date.now()}`
    const r1 = limiter.check(key, 5, 5000)
    expect(r1.ok).toBe(true)
    expect(r1.retryAfterMs).toBe(0)
  })

  it('allows exactly max requests', () => {
    const key = `test:exact:${Date.now()}`
    for (let i = 0; i < 3; i++) {
      const r = limiter.check(key, 3, 5000)
      expect(r.ok).toBe(true)
    }
  })

  it('rejects requests exceeding the limit', () => {
    const key = `test:over:${Date.now()}`
    for (let i = 0; i < 5; i++) {
      limiter.check(key, 5, 10_000)
    }
    // 6th request should be rejected
    const result = limiter.check(key, 5, 10_000)
    expect(result.ok).toBe(false)
    expect(result.retryAfterMs).toBeGreaterThan(0)
  })

  it('retryAfterMs is within window bounds', () => {
    const key = `test:retry:${Date.now()}`
    for (let i = 0; i < 3; i++) {
      limiter.check(key, 3, 5000)
    }
    const result = limiter.check(key, 3, 5000)
    expect(result.ok).toBe(false)
    expect(result.retryAfterMs).toBeLessThanOrEqual(5000)
    expect(result.retryAfterMs).toBeGreaterThan(0)
  })

  it('different keys are independent', () => {
    const keyA = `test:a:${Date.now()}`
    const keyB = `test:b:${Date.now()}`

    // Exhaust keyA
    for (let i = 0; i < 2; i++) {
      limiter.check(keyA, 2, 5000)
    }
    expect(limiter.check(keyA, 2, 5000).ok).toBe(false)

    // keyB should still work
    expect(limiter.check(keyB, 2, 5000).ok).toBe(true)
  })

  it('resets after window expires', async () => {
    const key = `test:expire:${Date.now()}`
    // Exhaust the limit in a very short window
    for (let i = 0; i < 2; i++) {
      limiter.check(key, 2, 50) // 50ms window
    }
    expect(limiter.check(key, 2, 50).ok).toBe(false)

    // Wait for window to pass
    await new Promise(r => setTimeout(r, 100))

    // Should be allowed again
    expect(limiter.check(key, 2, 50).ok).toBe(true)
  })

  it('uses default window of 5000ms when not specified', () => {
    const key = `test:default:${Date.now()}`
    const r = limiter.check(key, 10)
    expect(r.ok).toBe(true)
  })

  it('handles single-request limit', () => {
    const key = `test:single:${Date.now()}`
    expect(limiter.check(key, 1, 5000).ok).toBe(true)
    expect(limiter.check(key, 1, 5000).ok).toBe(false)
  })

  it('returns singleton instance', () => {
    const a = getRateLimiter()
    const b = getRateLimiter()
    expect(a).toBe(b)
  })
})
