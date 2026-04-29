/** Fired on `window` when `BroadcastChannel` is unavailable (legacy browsers). */
export const AAELINK_NOTIFICATIONS_INVALIDATE = 'aaelink-notifications-invalidate'

/** Same-origin tabs share this name so one tab marking read updates every bell. */
export const AAELINK_NOTIFICATIONS_BC = 'aaelink-notifications'

export type NotificationsInvalidatePayload = {
  unread_count?: number
}

type InvalidateMessage = { type: 'invalidate'; unread_count?: number }

/** Notify all tabs (and this tab) to refresh the notification bell; optional server `unread_count` updates the badge before GET completes. */
export function invalidateClientNotifications(payload?: NotificationsInvalidatePayload): void {
  if (typeof window === 'undefined') return
  const msg: InvalidateMessage = {
    type: 'invalidate',
    ...(typeof payload?.unread_count === 'number' && Number.isFinite(payload.unread_count)
      ? { unread_count: payload.unread_count }
      : {})
  }
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const b = new BroadcastChannel(AAELINK_NOTIFICATIONS_BC)
      b.postMessage(msg)
      b.close()
      return
    } catch {
      /* fall through */
    }
  }
  window.dispatchEvent(new CustomEvent(AAELINK_NOTIFICATIONS_INVALIDATE, { detail: msg }))
}
