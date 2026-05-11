/**
 * AAELink — Notification Preferences Type Tests
 */
import { describe, it, expect } from 'vitest'
import type { NotificationPrefRule } from '@/lib/notificationPrefs'

describe('NotificationPrefs — NotificationPrefRule type', () => {
  it('accepts mentions', () => {
    const rule: NotificationPrefRule = 'mentions'
    expect(rule).toBe('mentions')
  })

  it('accepts ticket_activity', () => {
    const rule: NotificationPrefRule = 'ticket_activity'
    expect(rule).toBe('ticket_activity')
  })

  it('accepts system', () => {
    const rule: NotificationPrefRule = 'system'
    expect(rule).toBe('system')
  })

  it('all rules are distinct', () => {
    const rules: NotificationPrefRule[] = ['mentions', 'ticket_activity', 'system']
    expect(new Set(rules).size).toBe(3)
  })
})
