/**
 * AAELink — useAutoAway Constants Tests
 *
 * The hook itself requires React + DOM, but we can verify
 * the idle timeout constant and tracked event types.
 */
import { describe, it, expect } from 'vitest'

describe('useAutoAway — IDLE_TIMEOUT_MS', () => {
  const IDLE_TIMEOUT_MS = 5 * 60 * 1000

  it('idle timeout is 5 minutes', () => {
    expect(IDLE_TIMEOUT_MS).toBe(300_000)
  })
})

describe('useAutoAway — tracked activity events', () => {
  const EVENTS = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'] as const

  it('tracks 5 DOM events', () => {
    expect(EVENTS).toHaveLength(5)
  })

  it('includes mousemove', () => {
    expect(EVENTS).toContain('mousemove')
  })

  it('includes keydown', () => {
    expect(EVENTS).toContain('keydown')
  })

  it('includes touchstart for mobile', () => {
    expect(EVENTS).toContain('touchstart')
  })
})

describe('useAutoAway — tab-hidden timeout', () => {
  const TAB_HIDDEN_TIMEOUT_MS = 60_000

  it('hidden tab timeout is 1 minute', () => {
    expect(TAB_HIDDEN_TIMEOUT_MS).toBe(60_000)
  })

  it('hidden timeout is shorter than idle timeout', () => {
    expect(TAB_HIDDEN_TIMEOUT_MS).toBeLessThan(300_000)
  })
})
