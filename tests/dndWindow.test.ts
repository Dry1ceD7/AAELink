/**
 * AAELink — DND active-window helper tests (pure, no DB).
 */
import { describe, it, expect } from 'vitest'
import { isDndActiveNow } from '@/lib/notifications/dndWindow'

// 2026-01-15 is a Thursday. Times below are UTC unless a tz is given.
const at = (utcHHMM: string) => new Date(`2026-01-15T${utcHHMM}:00.000Z`)

describe('isDndActiveNow', () => {
  it('same-day window: inside is active', () => {
    expect(isDndActiveNow('09:00', '17:00', 'UTC', at('12:00'))).toBe(true)
  })

  it('same-day window: before start is inactive', () => {
    expect(isDndActiveNow('09:00', '17:00', 'UTC', at('08:59'))).toBe(false)
  })

  it('same-day window: end is exclusive', () => {
    expect(isDndActiveNow('09:00', '17:00', 'UTC', at('17:00'))).toBe(false)
  })

  it('overnight window: after start (same day) is active', () => {
    expect(isDndActiveNow('22:00', '08:00', 'UTC', at('23:30'))).toBe(true)
  })

  it('overnight window: early morning is active', () => {
    expect(isDndActiveNow('22:00', '08:00', 'UTC', at('06:00'))).toBe(true)
  })

  it('overnight window: midday is inactive', () => {
    expect(isDndActiveNow('22:00', '08:00', 'UTC', at('13:00'))).toBe(false)
  })

  it('equal start/end is never active', () => {
    expect(isDndActiveNow('09:00', '09:00', 'UTC', at('09:00'))).toBe(false)
  })

  it('honours timezone: 12:00 UTC = 19:00 Asia/Bangkok (UTC+7)', () => {
    // Window 18:00–20:00 Bangkok; 12:00Z = 19:00 Bangkok ⇒ active.
    expect(isDndActiveNow('18:00', '20:00', 'Asia/Bangkok', at('12:00'))).toBe(true)
    // Same window evaluated in UTC ⇒ 12:00 is outside ⇒ inactive.
    expect(isDndActiveNow('18:00', '20:00', 'UTC', at('12:00'))).toBe(false)
  })

  it('malformed times are inactive (fail safe)', () => {
    expect(isDndActiveNow('bad', 'worse', 'UTC', at('12:00'))).toBe(false)
  })
})
