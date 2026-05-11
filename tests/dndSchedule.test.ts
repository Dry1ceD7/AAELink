/**
 * AAELink — DND Schedule Exhaustive Tests
 */
import { describe, it, expect } from 'vitest'
import { formatSchedule, getDndSchedule, type DndSchedule } from '@/lib/dndSchedule'

// ── formatSchedule ──────────────────────────────────────────────────

describe('DndSchedule — formatSchedule — AM/PM', () => {
  it('midnight = 12:00 AM', () => {
    const s: DndSchedule = { enabled: true, startHour: 0, startMinute: 0, endHour: 6, endMinute: 0 }
    expect(formatSchedule(s)).toBe('12:00 AM – 6:00 AM')
  })
  it('noon = 12:00 PM', () => {
    const s: DndSchedule = { enabled: true, startHour: 12, startMinute: 0, endHour: 13, endMinute: 0 }
    expect(formatSchedule(s)).toBe('12:00 PM – 1:00 PM')
  })
  it('1 AM = 1:00 AM', () => {
    const s: DndSchedule = { enabled: true, startHour: 1, startMinute: 0, endHour: 5, endMinute: 0 }
    expect(formatSchedule(s)).toBe('1:00 AM – 5:00 AM')
  })
  it('11 AM = 11:00 AM', () => {
    const s: DndSchedule = { enabled: true, startHour: 11, startMinute: 0, endHour: 12, endMinute: 0 }
    expect(formatSchedule(s)).toBe('11:00 AM – 12:00 PM')
  })
  it('1 PM = 1:00 PM', () => {
    const s: DndSchedule = { enabled: true, startHour: 13, startMinute: 0, endHour: 14, endMinute: 0 }
    expect(formatSchedule(s)).toBe('1:00 PM – 2:00 PM')
  })
  it('11 PM = 11:00 PM', () => {
    const s: DndSchedule = { enabled: true, startHour: 23, startMinute: 0, endHour: 0, endMinute: 0 }
    expect(formatSchedule(s)).toBe('11:00 PM – 12:00 AM')
  })
})

describe('DndSchedule — formatSchedule — minute padding', () => {
  it('pads single-digit minutes', () => {
    const s: DndSchedule = { enabled: false, startHour: 8, startMinute: 5, endHour: 20, endMinute: 0 }
    expect(formatSchedule(s)).toBe('8:05 AM – 8:00 PM')
  })
  it('zero minutes = :00', () => {
    const s: DndSchedule = { enabled: true, startHour: 9, startMinute: 0, endHour: 17, endMinute: 0 }
    expect(formatSchedule(s)).toBe('9:00 AM – 5:00 PM')
  })
  it('59 minutes = :59', () => {
    const s: DndSchedule = { enabled: true, startHour: 9, startMinute: 59, endHour: 17, endMinute: 30 }
    expect(formatSchedule(s)).toBe('9:59 AM – 5:30 PM')
  })
})

describe('DndSchedule — formatSchedule — window types', () => {
  it('overnight window (22:00-08:00)', () => {
    const s: DndSchedule = { enabled: true, startHour: 22, startMinute: 0, endHour: 8, endMinute: 0 }
    expect(formatSchedule(s)).toBe('10:00 PM – 8:00 AM')
  })
  it('daytime window (09:30-17:00)', () => {
    const s: DndSchedule = { enabled: true, startHour: 9, startMinute: 30, endHour: 17, endMinute: 0 }
    expect(formatSchedule(s)).toBe('9:30 AM – 5:00 PM')
  })
  it('full day (00:00-00:00)', () => {
    const s: DndSchedule = { enabled: true, startHour: 0, startMinute: 0, endHour: 0, endMinute: 0 }
    expect(formatSchedule(s)).toBe('12:00 AM – 12:00 AM')
  })
})

// ── getDndSchedule — server-side defaults ───────────────────────────

describe('DndSchedule — getDndSchedule (server-side)', () => {
  it('returns defaults when window is unavailable', () => {
    const sched = getDndSchedule()
    expect(sched.enabled).toBe(false)
    expect(sched.startHour).toBe(22)
    expect(sched.startMinute).toBe(0)
    expect(sched.endHour).toBe(8)
    expect(sched.endMinute).toBe(0)
  })
})

// ── DndSchedule type contract ───────────────────────────────────────

describe('DndSchedule — type contract', () => {
  it('DndSchedule has all required fields', () => {
    const s: DndSchedule = { enabled: true, startHour: 22, startMinute: 30, endHour: 8, endMinute: 0 }
    expect(s).toHaveProperty('enabled')
    expect(s).toHaveProperty('startHour')
    expect(s).toHaveProperty('startMinute')
    expect(s).toHaveProperty('endHour')
    expect(s).toHaveProperty('endMinute')
  })
  it('validates hour range (0-23)', () => {
    const hours = Array.from({ length: 24 }, (_, i) => i)
    for (const h of hours) {
      const s: DndSchedule = { enabled: true, startHour: h, startMinute: 0, endHour: h, endMinute: 0 }
      expect(formatSchedule(s)).toBeTruthy()
    }
  })
})
