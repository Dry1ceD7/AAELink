'use client'

import { hrefForNotification } from '@/lib/notifications/notificationHref'
import type { ApiNotification } from '@/lib/notifications/notificationTypes'

/**
 * OS/browser notification when the document is in the background and permission is granted.
 * Respects server-side `system_notifications_enabled` (caller passes flag).
 */
export function showSystemNotificationIfAllowed(
  n: ApiNotification,
  systemNotificationsEnabled: boolean
): void {
  if (!systemNotificationsEnabled) return
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  if (typeof document === 'undefined' || document.visibilityState !== 'hidden') return
  try {
    const inst = new Notification(n.title, { body: n.body || '', tag: n.id })
    const path = hrefForNotification(n)
    inst.onclick = () => {
      try {
        window.focus()
      } catch {
        /* ignore */
      }
      inst.close()
      window.location.assign(path)
    }
  } catch {
    /* ignore */
  }
}
