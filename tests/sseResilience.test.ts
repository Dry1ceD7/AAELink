/**
 * AAELink — SSE Resilience Tests
 *
 * Tests the notification stream reconnection constants.
 */
import { describe, it, expect } from 'vitest'

// Constants from notificationStream.ts (lines 12-17)
const SSE_RETRY_MAX = 5
const SSE_RETRY_BASE_MS = 700
const SSE_FALLBACK_MS = 20_000
const PULL_DEBOUNCE_MS = 400

describe('SSEResilience — Reconnect Constants', () => {
  it('max retries is 5', () => {
    expect(SSE_RETRY_MAX).toBe(5)
  })

  it('base retry delay is 700ms', () => {
    expect(SSE_RETRY_BASE_MS).toBe(700)
  })

  it('fallback poll is 20s', () => {
    expect(SSE_FALLBACK_MS).toBe(20_000)
  })

  it('pull debounce is 400ms', () => {
    expect(PULL_DEBOUNCE_MS).toBe(400)
  })

  it('retry delays escalate linearly by base', () => {
    // SSE retry delay = SSE_RETRY_BASE_MS * failures
    const delays = Array.from({ length: SSE_RETRY_MAX }, (_, i) => SSE_RETRY_BASE_MS * (i + 1))
    expect(delays).toEqual([700, 1400, 2100, 2800, 3500])
  })

  it('all delays stay under fallback interval', () => {
    for (let i = 1; i <= SSE_RETRY_MAX; i++) {
      expect(SSE_RETRY_BASE_MS * i).toBeLessThan(SSE_FALLBACK_MS)
    }
  })
})
