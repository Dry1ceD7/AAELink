/**
 * AAELink — Support OTP Rate Limit Tests
 */
import { describe, it, expect } from 'vitest'
import { supportOtpRateLimitHit } from '@/lib/supportOtpRateLimit'

describe('SupportOtpRateLimit', () => {
  it('allows first 5 requests', () => {
    const uid = `otp-test-${Date.now()}`
    for (let i = 0; i < 5; i++) {
      expect(supportOtpRateLimitHit(uid)).toBe(false)
    }
  })

  it('blocks 6th request', () => {
    const uid = `otp-block-${Date.now()}`
    for (let i = 0; i < 5; i++) supportOtpRateLimitHit(uid)
    expect(supportOtpRateLimitHit(uid)).toBe(true)
  })

  it('different users are independent', () => {
    const a = `otp-a-${Date.now()}`
    const b = `otp-b-${Date.now()}`
    for (let i = 0; i < 5; i++) supportOtpRateLimitHit(a)
    expect(supportOtpRateLimitHit(a)).toBe(true)
    expect(supportOtpRateLimitHit(b)).toBe(false)
  })
})
