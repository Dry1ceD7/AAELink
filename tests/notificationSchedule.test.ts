/**
 * AAELink — Notification Schedule Exhaustive Tests
 */
import { describe, it, expect } from 'vitest'
import { evaluateNotification, checkKeywordMatch, suppressionReason } from '@/lib/notificationSchedule'
import type { UserPreferences } from '@/lib/userPreferences'

function basePrefs(overrides: Partial<UserPreferences> = {}): UserPreferences {
  return {
    muteAllSounds: false,
    notifyOnlyWeekdays: false,
    notifyScheduleStart: '',
    notifyScheduleEnd: '',
    notifyKeywords: [],
    timezoneOverride: 'UTC',
    ...overrides,
  } as UserPreferences
}

// ── evaluateNotification — basic ────────────────────────────────────

describe('NotificationSchedule — evaluateNotification — basic', () => {
  it('allows by default (no restrictions)', () => {
    const d = evaluateNotification(basePrefs())
    expect(d.allowed).toBe(true)
    expect(d.soundAllowed).toBe(true)
  })

  it('DND blocks everything', () => {
    const d = evaluateNotification(basePrefs(), true)
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('dnd')
    expect(d.soundAllowed).toBe(false)
  })

  it('DND overrides mute (still blocked)', () => {
    const d = evaluateNotification(basePrefs({ muteAllSounds: true }), true)
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('dnd')
  })

  it('mutes sounds but still shows visual', () => {
    const d = evaluateNotification(basePrefs({ muteAllSounds: true }))
    expect(d.allowed).toBe(true)
    expect(d.soundAllowed).toBe(false)
  })
})

// ── evaluateNotification — weekend ──────────────────────────────────

describe('NotificationSchedule — evaluateNotification — weekday-only', () => {
  it('blocks Sunday', () => {
    const sunday = new Date('2026-01-04T10:00:00Z') // Sunday
    const d = evaluateNotification(basePrefs({ notifyOnlyWeekdays: true }), false, sunday)
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('weekend')
  })

  it('blocks Saturday', () => {
    const saturday = new Date('2026-01-03T10:00:00Z') // Saturday
    const d = evaluateNotification(basePrefs({ notifyOnlyWeekdays: true }), false, saturday)
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('weekend')
  })

  it('allows Monday', () => {
    const monday = new Date('2026-01-05T10:00:00Z')
    const d = evaluateNotification(basePrefs({ notifyOnlyWeekdays: true }), false, monday)
    expect(d.allowed).toBe(true)
  })

  it('allows Tuesday', () => {
    const tuesday = new Date('2026-01-06T10:00:00Z')
    const d = evaluateNotification(basePrefs({ notifyOnlyWeekdays: true }), false, tuesday)
    expect(d.allowed).toBe(true)
  })

  it('allows Wednesday', () => {
    const wednesday = new Date('2026-01-07T10:00:00Z')
    const d = evaluateNotification(basePrefs({ notifyOnlyWeekdays: true }), false, wednesday)
    expect(d.allowed).toBe(true)
  })

  it('allows Thursday', () => {
    const thursday = new Date('2026-01-08T10:00:00Z')
    const d = evaluateNotification(basePrefs({ notifyOnlyWeekdays: true }), false, thursday)
    expect(d.allowed).toBe(true)
  })

  it('allows Friday', () => {
    const friday = new Date('2026-01-09T10:00:00Z')
    const d = evaluateNotification(basePrefs({ notifyOnlyWeekdays: true }), false, friday)
    expect(d.allowed).toBe(true)
  })

  it('weekend check disabled does not block weekends', () => {
    const sunday = new Date('2026-01-04T10:00:00Z')
    const d = evaluateNotification(basePrefs({ notifyOnlyWeekdays: false }), false, sunday)
    expect(d.allowed).toBe(true)
  })
})

// ── evaluateNotification — schedule (normal range) ──────────────────

describe('NotificationSchedule — evaluateNotification — schedule (normal)', () => {
  const prefs = basePrefs({ notifyScheduleStart: '09:00', notifyScheduleEnd: '17:00' })

  it('blocks at 8 AM (before start)', () => {
    const d = evaluateNotification(prefs, false, new Date('2026-01-05T08:00:00Z'))
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('schedule')
  })

  it('allows at 9 AM (at start)', () => {
    const d = evaluateNotification(prefs, false, new Date('2026-01-05T09:00:00Z'))
    expect(d.allowed).toBe(true)
  })

  it('allows at noon', () => {
    const d = evaluateNotification(prefs, false, new Date('2026-01-05T12:00:00Z'))
    expect(d.allowed).toBe(true)
  })

  it('allows at 4:59 PM (just before end)', () => {
    const d = evaluateNotification(prefs, false, new Date('2026-01-05T16:59:00Z'))
    expect(d.allowed).toBe(true)
  })

  it('blocks at 5 PM (at end)', () => {
    const d = evaluateNotification(prefs, false, new Date('2026-01-05T17:00:00Z'))
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('schedule')
  })

  it('blocks at 8 PM (after end)', () => {
    const d = evaluateNotification(prefs, false, new Date('2026-01-05T20:00:00Z'))
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('schedule')
  })

  it('blocks at midnight', () => {
    const d = evaluateNotification(prefs, false, new Date('2026-01-05T00:00:00Z'))
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('schedule')
  })
})

// ── evaluateNotification — schedule (overnight) ─────────────────────

describe('NotificationSchedule — evaluateNotification — schedule (overnight)', () => {
  // Overnight: allowed from 22:00 to 08:00 (active hours span midnight)
  const prefs = basePrefs({ notifyScheduleStart: '22:00', notifyScheduleEnd: '08:00' })

  it('allows at 23:00 (after start)', () => {
    const d = evaluateNotification(prefs, false, new Date('2026-01-05T23:00:00Z'))
    expect(d.allowed).toBe(true)
  })

  it('allows at midnight', () => {
    const d = evaluateNotification(prefs, false, new Date('2026-01-06T00:00:00Z'))
    expect(d.allowed).toBe(true)
  })

  it('allows at 3 AM', () => {
    const d = evaluateNotification(prefs, false, new Date('2026-01-06T03:00:00Z'))
    expect(d.allowed).toBe(true)
  })

  it('blocks at 10 AM (outside overnight range)', () => {
    const d = evaluateNotification(prefs, false, new Date('2026-01-05T10:00:00Z'))
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('schedule')
  })

  it('blocks at 12 PM', () => {
    const d = evaluateNotification(prefs, false, new Date('2026-01-05T12:00:00Z'))
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('schedule')
  })

  it('blocks at 21:59 (just before start)', () => {
    const d = evaluateNotification(prefs, false, new Date('2026-01-05T21:59:00Z'))
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('schedule')
  })
})

// ── evaluateNotification — combined rules ───────────────────────────

describe('NotificationSchedule — evaluateNotification — combined', () => {
  it('DND overrides schedule + weekend', () => {
    const prefs = basePrefs({
      notifyOnlyWeekdays: true,
      notifyScheduleStart: '09:00',
      notifyScheduleEnd: '17:00',
    })
    const d = evaluateNotification(prefs, true, new Date('2026-01-05T12:00:00Z'))
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('dnd')
  })

  it('weekend check runs before schedule check', () => {
    const prefs = basePrefs({
      notifyOnlyWeekdays: true,
      notifyScheduleStart: '09:00',
      notifyScheduleEnd: '17:00',
    })
    const sunday = new Date('2026-01-04T12:00:00Z')
    const d = evaluateNotification(prefs, false, sunday)
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('weekend')
  })

  it('muted sounds + schedule allowed → allowed but no sound', () => {
    const prefs = basePrefs({
      muteAllSounds: true,
      notifyScheduleStart: '09:00',
      notifyScheduleEnd: '17:00',
    })
    const d = evaluateNotification(prefs, false, new Date('2026-01-05T12:00:00Z'))
    expect(d.allowed).toBe(true)
    expect(d.soundAllowed).toBe(false)
  })
})

// ── checkKeywordMatch ───────────────────────────────────────────────

describe('NotificationSchedule — checkKeywordMatch', () => {
  it('matches keyword in message', () => {
    expect(checkKeywordMatch('urgent: deploy now', basePrefs({ notifyKeywords: ['urgent'] }))).toBe(true)
  })
  it('case insensitive match', () => {
    expect(checkKeywordMatch('URGENT fix', basePrefs({ notifyKeywords: ['urgent'] }))).toBe(true)
  })
  it('no match', () => {
    expect(checkKeywordMatch('normal message', basePrefs({ notifyKeywords: ['urgent'] }))).toBe(false)
  })
  it('empty keywords list → false', () => {
    expect(checkKeywordMatch('anything', basePrefs())).toBe(false)
  })
  it('matches any of multiple keywords', () => {
    const prefs = basePrefs({ notifyKeywords: ['urgent', 'deploy', 'critical'] })
    expect(checkKeywordMatch('time to deploy', prefs)).toBe(true)
    expect(checkKeywordMatch('critical bug found', prefs)).toBe(true)
    expect(checkKeywordMatch('normal update', prefs)).toBe(false)
  })
  it('matches partial word', () => {
    expect(checkKeywordMatch('urgently needed', basePrefs({ notifyKeywords: ['urgent'] }))).toBe(true)
  })
  it('handles empty message', () => {
    expect(checkKeywordMatch('', basePrefs({ notifyKeywords: ['urgent'] }))).toBe(false)
  })
  it('skips empty keyword entries', () => {
    expect(checkKeywordMatch('test', basePrefs({ notifyKeywords: ['', ''] }))).toBe(false)
  })
})

// ── suppressionReason ───────────────────────────────────────────────

describe('NotificationSchedule — suppressionReason', () => {
  it('dnd → "Do Not Disturb is active"', () => {
    expect(suppressionReason('dnd')).toBe('Do Not Disturb is active')
  })
  it('schedule → "Outside notification hours"', () => {
    expect(suppressionReason('schedule')).toBe('Outside notification hours')
  })
  it('weekend → "Notifications paused on weekends"', () => {
    expect(suppressionReason('weekend')).toBe('Notifications paused on weekends')
  })
  it('muted → "All sounds muted"', () => {
    expect(suppressionReason('muted')).toBe('All sounds muted')
  })
  it('undefined → empty string', () => {
    expect(suppressionReason(undefined)).toBe('')
  })
  it('unknown reason → empty string', () => {
    expect(suppressionReason('some_unknown')).toBe('')
  })
})
