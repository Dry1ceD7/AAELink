/**
 * AAELink — User Preferences Tests
 */
import { describe, it, expect } from 'vitest'
import { getAutoTimezone, getEffectiveTimezone, type UserPreferences } from '@/lib/ui/userPreferences'

describe('UserPreferences — getAutoTimezone', () => {
  it('returns a non-empty IANA timezone', () => {
    const tz = getAutoTimezone()
    expect(tz.length).toBeGreaterThan(0)
    expect(tz).toContain('/')
  })
})

describe('UserPreferences — getEffectiveTimezone', () => {
  it('uses override when set', () => {
    const tz = getEffectiveTimezone({ timezoneOverride: 'America/New_York' } as UserPreferences)
    expect(tz).toBe('America/New_York')
  })

  it('falls back to auto when empty override', () => {
    const tz = getEffectiveTimezone({ timezoneOverride: '' } as UserPreferences)
    expect(tz).toContain('/')
  })
})
