/**
 * AAELink — Notification Invalidate Tests
 */
import { describe, it, expect } from 'vitest'
import {
  AAELINK_NOTIFICATIONS_INVALIDATE,
  AAELINK_NOTIFICATIONS_BC,
  type NotificationsInvalidatePayload,
} from '@/lib/notifications/notificationInvalidate'

describe('NotificationInvalidate — Constants', () => {
  it('custom event name is defined', () => {
    expect(AAELINK_NOTIFICATIONS_INVALIDATE).toBe('aaelink-notifications-invalidate')
  })

  it('broadcast channel name is defined', () => {
    expect(AAELINK_NOTIFICATIONS_BC).toBe('aaelink-notifications')
  })
})

describe('NotificationInvalidate — Payload type', () => {
  it('accepts payload with unread_count', () => {
    const p: NotificationsInvalidatePayload = { unread_count: 5 }
    expect(p.unread_count).toBe(5)
  })

  it('accepts empty payload', () => {
    const p: NotificationsInvalidatePayload = {}
    expect(p.unread_count).toBeUndefined()
  })
})
