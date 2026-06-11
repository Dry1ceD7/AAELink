/**
 * User Preferences engine for AAELink.
 * localStorage-backed with typed defaults, auto-save, and change listeners.
 *
 * Note: `messageDensity` is the single source of truth for compact UI mode.
 * Setting `messageDensity = 'compact'` also flips `data-mm-density="compact"`
 * on `<html>` (via `lib/uiDensity.ts`) so the sidebar, channel header, and
 * composer all tighten together. The `data-density` attribute drives the
 * message timeline scope; `data-mm-density` drives the surrounding chrome.
 */

import { persistUiDensity } from '@/lib/ui/uiDensity'

export interface UserPreferences {
  // ── Messaging ──
  sendOnEnter: boolean              // true = Enter sends, false = Ctrl/Cmd+Enter sends
  showTypingIndicators: boolean
  showLinkPreviews: boolean

  // ── Appearance ──
  messageDensity: 'cozy' | 'compact' // cozy = avatars & spacing, compact = dense text-only
  accentColor: string                // hex code, default AAELink blue
  showAvatarsInTimeline: boolean

  // ── Time & Region ──
  timeFormat: '12h' | '24h'
  timezoneOverride: string           // empty = auto-detect, otherwise IANA tz name
  dateFormat: 'auto' | 'YYYY-MM-DD' | 'MM/DD/YYYY' | 'DD/MM/YYYY'

  // ── Notifications ──
  notifyKeywords: string[]           // words that trigger notifications
  muteAllSounds: boolean
  notifyOnlyWeekdays: boolean
  notifyScheduleStart: string        // "09:00"
  notifyScheduleEnd: string          // "17:00"

  // ── Accessibility ──
  uiScale: number                    // 80–150, percent
  highContrast: boolean
  reduceMotion: boolean

  // ── Advanced ──
  searchExcludeChannels: string[]    // channel IDs to exclude from global search
  spellcheck: boolean
  markdownPreview: boolean

  // ── Sidebar ──
  dmSortOrder: 'recent' | 'alpha'
  showChannelPreviews: boolean

  // ── Mark As Read (Slack parity §10.1) ──
  /**
   * Where to land when opening a channel:
   *   'newest'        — jump to the most recent message
   *   'oldest_unread' — start at the first unread (Slack default)
   *   'most_recent'   — preserve the last viewed position
   */
  markAsReadStart: 'newest' | 'oldest_unread' | 'most_recent'
  /** When pressing Esc on a channel, mark all unread messages as read. */
  escMarksAllRead: boolean

  // ── Audio & Video defaults (Slack parity §10) ──
  /** Default microphone state on huddle/call join. */
  defaultMuteOnJoin: boolean
  /** Default camera state on huddle/call join. */
  defaultCameraOnJoin: boolean
  /** Apply browser noise suppression to outgoing audio. */
  noiseSuppression: boolean
  /** Last-used IDs (for device pickers); empty = system default. */
  preferredMicId: string
  preferredCameraId: string
  preferredSpeakerId: string

  // ── Also notify about (Slack parity §Notifications) ──
  /** Notify when someone replies in a thread you follow. */
  notifyThreadReplies: boolean
  /** Notify when a huddle starts in a channel/DM you're in. */
  notifyHuddleStart: boolean
  /** Notify when a VIP messages while DND is active (paid-tier parity). */
  notifyVipDuringDnd: boolean
}

const DEFAULTS: UserPreferences = {
  sendOnEnter: true,
  showTypingIndicators: true,
  showLinkPreviews: true,
  messageDensity: 'cozy',
  accentColor: '#1C58D9',
  showAvatarsInTimeline: true,
  timeFormat: '12h',
  timezoneOverride: '',
  dateFormat: 'auto',
  notifyKeywords: [],
  muteAllSounds: false,
  notifyOnlyWeekdays: false,
  notifyScheduleStart: '09:00',
  notifyScheduleEnd: '17:00',
  uiScale: 100,
  highContrast: false,
  reduceMotion: false,
  searchExcludeChannels: [],
  spellcheck: true,
  markdownPreview: false,
  dmSortOrder: 'recent',
  showChannelPreviews: true,
  markAsReadStart: 'oldest_unread',
  escMarksAllRead: false,
  defaultMuteOnJoin: false,
  defaultCameraOnJoin: false,
  noiseSuppression: true,
  preferredMicId: '',
  preferredCameraId: '',
  preferredSpeakerId: '',
  notifyThreadReplies: true,
  notifyHuddleStart: true,
  notifyVipDuringDnd: false,
}

const STORAGE_KEY = 'aaelink-user-prefs'

let _cached: UserPreferences | null = null
const _listeners: Set<() => void> = new Set()

/** Read all preferences (cached). */
export function readPreferences(): UserPreferences {
  if (_cached) return _cached
  if (typeof window === 'undefined') return { ...DEFAULTS }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UserPreferences>
      _cached = { ...DEFAULTS, ...parsed }
    } else {
      _cached = { ...DEFAULTS }
    }
  } catch {
    _cached = { ...DEFAULTS }
  }
  return _cached!
}

/** Update one or more preferences. Auto-persists. */
export function updatePreferences(patch: Partial<UserPreferences>): UserPreferences {
  const current = readPreferences()
  const next = { ...current, ...patch }
  _cached = next
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch { /* quota exceeded */ }
  }
  // Notify listeners
  _listeners.forEach(fn => fn())
  // Apply side effects
  applyPreferenceSideEffects(next)
  return next
}

/** Subscribe to preference changes. Returns unsubscribe function. */
export function onPreferencesChange(fn: () => void): () => void {
  _listeners.add(fn)
  return () => _listeners.delete(fn)
}

/** Read a single preference. */
export function readPref<K extends keyof UserPreferences>(key: K): UserPreferences[K] {
  return readPreferences()[key]
}

/** Apply side effects for preferences that affect the DOM. */
function applyPreferenceSideEffects(prefs: UserPreferences) {
  if (typeof document === 'undefined') return

  // UI scale
  document.documentElement.style.fontSize = prefs.uiScale === 100 ? '' : `${prefs.uiScale}%`

  // High contrast
  document.documentElement.classList.toggle('high-contrast', prefs.highContrast)

  // Reduce motion
  document.documentElement.classList.toggle('reduce-motion', prefs.reduceMotion)

  // Accent color
  document.documentElement.style.setProperty('--aae-accent', prefs.accentColor)

  // Message density — drives the timeline scope
  document.documentElement.setAttribute('data-density', prefs.messageDensity)

  // Mirror message density to UI density so the sidebar, channel header,
  // and composer tighten in lockstep with the message timeline.
  persistUiDensity(prefs.messageDensity === 'compact' ? 'compact' : 'comfortable')
}

/** Boot preferences: read and apply side effects. */
export function bootPreferences() {
  const prefs = readPreferences()
  applyPreferenceSideEffects(prefs)
}

/** Get auto-detected timezone. */
export function getAutoTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'UTC'
  }
}

/** Get the effective timezone (override or auto). */
export function getEffectiveTimezone(prefs?: UserPreferences): string {
  const p = prefs || readPreferences()
  return p.timezoneOverride || getAutoTimezone()
}

/** Format a date according to user time preferences. */
export function formatUserTime(date: Date, prefs?: UserPreferences): string {
  const p = prefs || readPreferences()
  const tz = getEffectiveTimezone(p)
  const hour12 = p.timeFormat === '12h'
  try {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12, timeZone: tz })
  } catch {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12 })
  }
}
