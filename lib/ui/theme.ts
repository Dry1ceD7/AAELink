/**
 * Theme preference management for AAELink.
 * Four modes: 'light', 'dark', 'system' (follow OS), 'schedule' (time-based auto).
 */

export type ThemePreference = 'light' | 'dark' | 'system' | 'schedule'

interface ScheduleConfig {
  /** Hour (0-23) when dark mode activates. Default: 19 (7 PM) */
  darkStart: number
  /** Hour (0-23) when light mode activates. Default: 7 (7 AM) */
  lightStart: number
}

const STORAGE_KEY = 'aaelink-theme'
const SCHEDULE_KEY = 'aaelink-theme-schedule'

const DEFAULT_SCHEDULE: ScheduleConfig = { darkStart: 19, lightStart: 7 }

/** Read persisted theme preference. */
export function readThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system'
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system' || v === 'schedule') return v
  } catch { /* noop */ }
  return 'system'
}

/** Read the schedule config. */
export function readScheduleConfig(): ScheduleConfig {
  if (typeof window === 'undefined') return DEFAULT_SCHEDULE
  try {
    const raw = localStorage.getItem(SCHEDULE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ScheduleConfig>
      return {
        darkStart: typeof parsed.darkStart === 'number' ? parsed.darkStart : DEFAULT_SCHEDULE.darkStart,
        lightStart: typeof parsed.lightStart === 'number' ? parsed.lightStart : DEFAULT_SCHEDULE.lightStart,
      }
    }
  } catch { /* noop */ }
  return DEFAULT_SCHEDULE
}

/** Persist the schedule config. */
export function persistScheduleConfig(config: ScheduleConfig) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(SCHEDULE_KEY, JSON.stringify(config))
  } catch { /* noop */ }
}

/** Persist and apply the chosen theme preference. */
export function persistThemePreference(pref: ThemePreference) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, pref)
  } catch { /* noop */ }
  applyTheme(pref)
}

/** Resolve the effective theme for the given preference. */
function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
  if (pref === 'light' || pref === 'dark') return pref
  if (pref === 'schedule') {
    return resolveScheduleTheme()
  }
  // system mode
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

/** Determine theme based on current time and schedule config. */
function resolveScheduleTheme(): 'light' | 'dark' {
  const config = readScheduleConfig()
  const hour = new Date().getHours()

  // Handle wrap-around: if darkStart > lightStart, dark period spans midnight
  if (config.darkStart > config.lightStart) {
    // Dark from darkStart to lightStart (wrapping midnight)
    return (hour >= config.darkStart || hour < config.lightStart) ? 'dark' : 'light'
  } else {
    // Normal: dark from darkStart to lightStart
    return (hour >= config.darkStart || hour < config.lightStart) ? 'dark' : 'light'
  }
}

/** Apply the theme to the document. */
export function applyTheme(pref: ThemePreference) {
  if (typeof document === 'undefined') return
  const effective = resolveTheme(pref)
  const html = document.documentElement

  // Add transition class for smooth theme switching
  html.classList.add('theme-transition')

  html.setAttribute('data-theme', effective)
  html.style.colorScheme = effective

  // Remove transition class after animation completes
  requestAnimationFrame(() => {
    setTimeout(() => html.classList.remove('theme-transition'), 350)
  })
}

/** Boot the theme system: apply saved preference and listen for OS/time changes. */
export function bootTheme(): () => void {
  if (typeof window === 'undefined') return () => {}
  const pref = readThemePreference()
  applyTheme(pref)

  // Listen for OS dark-mode changes when in 'system' mode
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => {
    const current = readThemePreference()
    if (current === 'system') applyTheme('system')
  }
  mq.addEventListener('change', onChange)

  // For schedule mode: re-evaluate every minute
  let scheduleInterval: ReturnType<typeof setInterval> | null = null
  if (pref === 'schedule') {
    scheduleInterval = setInterval(() => {
      const current = readThemePreference()
      if (current === 'schedule') applyTheme('schedule')
    }, 60_000)
  }

  // Also listen for storage changes (schedule config updates from settings)
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === SCHEDULE_KEY) {
      const current = readThemePreference()
      applyTheme(current)
    }
  }
  window.addEventListener('storage', onStorage)

  return () => {
    mq.removeEventListener('change', onChange)
    window.removeEventListener('storage', onStorage)
    if (scheduleInterval) clearInterval(scheduleInterval)
  }
}
