/**
 * Notification Schedule Engine for AAELink.
 * 
 * Evaluates user preferences to determine if notifications should be
 * suppressed based on:
 *  - Active hours (notifyScheduleStart / notifyScheduleEnd)
 *  - Weekday-only mode
 *  - Mute all sounds
 *  - User DND status
 * 
 * This module works both client-side and server-side.
 */

import { readPreferences, type UserPreferences, getEffectiveTimezone } from '@/lib/ui/userPreferences'

interface NotificationDecision {
  /** Should the notification be shown? */
  allowed: boolean
  /** If suppressed, the reason */
  reason?: 'muted' | 'schedule' | 'weekend' | 'dnd'
  /** Should sounds be played? */
  soundAllowed: boolean
}

/**
 * Evaluate whether a notification should be delivered right now.
 * 
 * @param prefs - User preferences (optional; reads from localStorage if omitted)
 * @param dndActive - Whether user is currently in DND mode (from user_status)
 * @param now - Optional Date override for testing
 */
export function evaluateNotification(
  prefs?: UserPreferences,
  dndActive?: boolean,
  now?: Date
): NotificationDecision {
  const p = prefs || readPreferences()
  const timestamp = now || new Date()

  // DND from status overrides everything
  if (dndActive) {
    return { allowed: false, reason: 'dnd', soundAllowed: false }
  }

  // Global mute suppresses sounds but still shows visual notifications
  const soundAllowed = !p.muteAllSounds

  // Weekend check
  if (p.notifyOnlyWeekdays) {
    const tz = getEffectiveTimezone(p)
    const dayOfWeek = getDayInTimezone(timestamp, tz)
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return { allowed: false, reason: 'weekend', soundAllowed: false }
    }
  }

  // Schedule check (active hours)
  if (p.notifyScheduleStart && p.notifyScheduleEnd) {
    const tz = getEffectiveTimezone(p)
    const currentMinutes = getMinutesInTimezone(timestamp, tz)
    const startMinutes = parseTimeToMinutes(p.notifyScheduleStart)
    const endMinutes = parseTimeToMinutes(p.notifyScheduleEnd)

    if (startMinutes !== null && endMinutes !== null) {
      // Normal range: e.g. 09:00 – 17:00
      if (startMinutes < endMinutes) {
        if (currentMinutes < startMinutes || currentMinutes >= endMinutes) {
          return { allowed: false, reason: 'schedule', soundAllowed: false }
        }
      }
      // Overnight range: e.g. 22:00 – 08:00 (start > end means overnight)
      else if (startMinutes > endMinutes) {
        if (currentMinutes >= endMinutes && currentMinutes < startMinutes) {
          return { allowed: false, reason: 'schedule', soundAllowed: false }
        }
      }
    }
  }

  return { allowed: true, soundAllowed }
}

/**
 * Check if a message should trigger a keyword notification.
 */
export function checkKeywordMatch(message: string, prefs?: UserPreferences): boolean {
  const p = prefs || readPreferences()
  if (!p.notifyKeywords || p.notifyKeywords.length === 0) return false
  const lower = message.toLowerCase()
  return p.notifyKeywords.some(kw => kw && lower.includes(kw.toLowerCase()))
}

/**
 * Format a suppression reason into a human-readable string.
 */
export function suppressionReason(reason?: string): string {
  switch (reason) {
    case 'dnd': return 'Do Not Disturb is active'
    case 'schedule': return 'Outside notification hours'
    case 'weekend': return 'Notifications paused on weekends'
    case 'muted': return 'All sounds muted'
    default: return ''
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────

function parseTimeToMinutes(time: string): number | null {
  const match = time.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const h = parseInt(match[1], 10)
  const m = parseInt(match[2], 10)
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  return h * 60 + m
}

function getDayInTimezone(date: Date, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).formatToParts(date)
    const weekday = parts.find(p => p.type === 'weekday')?.value
    const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
    return dayMap[weekday || ''] ?? date.getDay()
  } catch {
    return date.getDay()
  }
}

function getMinutesInTimezone(date: Date, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', minute: 'numeric', hour12: false, timeZone: tz
    }).formatToParts(date)
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10)
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10)
    return hour * 60 + minute
  } catch {
    return date.getHours() * 60 + date.getMinutes()
  }
}
