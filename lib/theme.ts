/**
 * Theme preference management for AAELink.
 * Three modes: 'light', 'dark', 'system' (follow OS setting).
 */

export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'aaelink-theme'

/** Read persisted theme preference. */
export function readThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system'
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch { /* noop */ }
  return 'system'
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
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

/** Apply the theme to the document. */
export function applyTheme(pref: ThemePreference) {
  if (typeof document === 'undefined') return
  const effective = resolveTheme(pref)
  const html = document.documentElement

  html.setAttribute('data-theme', effective)
  html.style.colorScheme = effective
}

/** Boot the theme system: apply saved preference and listen for OS changes. */
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
  return () => mq.removeEventListener('change', onChange)
}
