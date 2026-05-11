/**
 * Desktop & Browser Push Notification Client for AAELink.
 * 
 * Handles:
 *  - Browser Notification API (with permission request)
 *  - Desktop app bridge (Electron notifications)
 *  - Sound playback (message sounds)
 *  - Notification schedule enforcement
 *  - Keyword highlighting
 */

import { evaluateNotification, checkKeywordMatch } from './notificationSchedule'
import { readPreferences } from './userPreferences'
import { playNotificationSound } from './notificationSound'

interface NotifyOptions {
  title: string
  body: string
  /** The raw message text (for keyword checking) */
  rawMessage?: string
  /** Whether the user is currently in DND status */
  dndActive?: boolean
  /** Channel name or DM name for grouping */
  tag?: string
  /** Click handler */
  onClick?: () => void
  /** Icon URL */
  icon?: string
}

/**
 * Request browser notification permission (call on first user interaction).
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  return Notification.requestPermission()
}

/**
 * Send a notification to the user, respecting their preferences & schedule.
 * Returns true if the notification was shown.
 */
export function sendNotification(options: NotifyOptions): boolean {
  const prefs = readPreferences()
  const decision = evaluateNotification(prefs, options.dndActive)

  if (!decision.allowed) {
    return false
  }

  // Show browser/desktop notification
  showNativeNotification(options)

  // Play sound if allowed
  if (decision.soundAllowed) {
    playNotificationSound()
  }

  return true
}

/**
 * Send a notification specifically for keyword matches.
 * Returns true if the keyword matched AND notification was shown.
 */
export function sendKeywordNotification(
  message: string,
  senderName: string,
  channelName: string,
  onClick?: () => void,
  dndActive?: boolean
): boolean {
  if (!checkKeywordMatch(message)) return false

  return sendNotification({
    title: `Keyword match in #${channelName}`,
    body: `${senderName}: ${message.slice(0, 120)}`,
    rawMessage: message,
    dndActive,
    tag: `keyword-${channelName}`,
    onClick,
  })
}

/**
 * Send a direct message notification.
 */
export function sendDmNotification(
  senderName: string,
  message: string,
  onClick?: () => void,
  dndActive?: boolean,
  avatarUrl?: string
): boolean {
  return sendNotification({
    title: senderName,
    body: message.slice(0, 200),
    rawMessage: message,
    dndActive,
    tag: `dm-${senderName}`,
    onClick,
    icon: avatarUrl,
  })
}

/**
 * Send a mention notification.
 */
export function sendMentionNotification(
  senderName: string,
  channelName: string,
  message: string,
  onClick?: () => void,
  dndActive?: boolean
): boolean {
  return sendNotification({
    title: `Mentioned in #${channelName}`,
    body: `${senderName}: ${message.slice(0, 120)}`,
    rawMessage: message,
    dndActive,
    tag: `mention-${channelName}`,
    onClick,
  })
}

// ── Internal helpers ──────────────────────────────────────────────────────

function showNativeNotification(options: NotifyOptions) {
  // Try Electron desktop bridge first
  if (typeof window !== 'undefined' && window.aaelinkDesktop?.showNotification) {
    window.aaelinkDesktop.showNotification({
      title: options.title,
      body: options.body,
      icon: options.icon,
    })
    return
  }

  // Browser Notification API
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      const n = new Notification(options.title, {
        body: options.body,
        icon: options.icon || '/icons/pwa-192.png',
        tag: options.tag,
        silent: true, // We handle sound separately
      })
      if (options.onClick) {
        n.onclick = () => {
          window.focus()
          options.onClick!()
          n.close()
        }
      }
      // Auto-close after 5 seconds
      setTimeout(() => n.close(), 5000)
    } catch { /* Service worker context or blocked */ }
  }
}



