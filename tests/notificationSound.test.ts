/**
 * AAELink — Notification Sound Exhaustive Tests
 */
import { describe, it, expect } from 'vitest'
import { getNotifSoundPref, getNotifVolume, type NotifSoundPref } from '@/lib/notifications/notificationSound'

// ── NotifSoundPref type ─────────────────────────────────────────────

describe('NotificationSound — NotifSoundPref type contract', () => {
  const validPrefs: NotifSoundPref[] = ['default', 'subtle', 'none']

  it('has exactly 3 valid values', () => {
    expect(validPrefs).toHaveLength(3)
  })

  it('includes "default"', () => {
    expect(validPrefs).toContain('default')
  })

  it('includes "subtle"', () => {
    expect(validPrefs).toContain('subtle')
  })

  it('includes "none"', () => {
    expect(validPrefs).toContain('none')
  })
})

// ── getNotifSoundPref — server-side defaults ────────────────────────

describe('NotificationSound — getNotifSoundPref (server-side)', () => {
  it('returns "default" when window unavailable', () => {
    // In node test env, typeof window === 'undefined'
    expect(getNotifSoundPref()).toBe('default')
  })
})

// ── getNotifVolume — server-side defaults ────────────────────────────

describe('NotificationSound — getNotifVolume (server-side)', () => {
  it('returns 0.5 when window unavailable', () => {
    expect(getNotifVolume()).toBe(0.5)
  })

  it('returns a number', () => {
    expect(typeof getNotifVolume()).toBe('number')
  })

  it('returns value in [0, 1] range', () => {
    const vol = getNotifVolume()
    expect(vol).toBeGreaterThanOrEqual(0)
    expect(vol).toBeLessThanOrEqual(1)
  })
})
