/**
 * AAELink — Contact OTP Delivery Status Tests
 */
import { describe, it, expect } from 'vitest'
import { contactOtpDeliveryStatus } from '@/lib/sendContactOtp'

describe('SendContactOtp — contactOtpDeliveryStatus', () => {
  it('returns an object with email_ready and sms_ready', () => {
    const status = contactOtpDeliveryStatus()
    expect(typeof status.email_ready).toBe('boolean')
    expect(typeof status.sms_ready).toBe('boolean')
  })

  it('sms_ready is false without env vars', () => {
    // Twilio env vars are not set in test environment
    const status = contactOtpDeliveryStatus()
    expect(status.sms_ready).toBe(false)
  })
})
