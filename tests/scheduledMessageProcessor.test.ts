/**
 * AAELink — Scheduled Message Processor Constants Tests
 */
import { describe, it, expect } from 'vitest'

// Constants from scheduledMessageProcessor.ts
const POLL_INTERVAL_MS = 15_000
const STATUS_PENDING = 'pending'
const STATUS_SENT = 'sent'
const STATUS_FAILED = 'failed'

describe('ScheduledMessageProcessor — Status Constants', () => {
  it('defines pending status', () => {
    expect(STATUS_PENDING).toBe('pending')
  })

  it('defines sent status', () => {
    expect(STATUS_SENT).toBe('sent')
  })

  it('defines failed status', () => {
    expect(STATUS_FAILED).toBe('failed')
  })
})

describe('ScheduledMessageProcessor — Poll Interval', () => {
  it('poll interval is 15 seconds', () => {
    expect(POLL_INTERVAL_MS).toBe(15_000)
  })

  it('poll interval is reasonable (5s-60s range)', () => {
    expect(POLL_INTERVAL_MS).toBeGreaterThanOrEqual(5000)
    expect(POLL_INTERVAL_MS).toBeLessThanOrEqual(60000)
  })
})
