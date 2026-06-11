/**
 * Theme palette — Slack-class named themes that recolor the sidebar / header
 * chrome on top of the underlying light/dark mode.
 *
 * The "mode" (light vs dark) controls the message timeline background and
 * primary chrome. A "palette" is a named set of accent colors that override
 * sidebar bg, sidebar text active/hover, and the header tint. Slack ships a
 * canonical 11-pack: Aubergine, Banana, Forest, Hoth, Mint, Nocturne, Ochin,
 * Terminal, Wartocks, Workhaus, plus the default Light/Dark.
 *
 * AAELink's port keeps the colour names as a tribute. Each palette ships
 * sane fallbacks for both light and dark mode so users can mix-and-match.
 *
 * Persistence: localStorage `aaelink-theme-palette` = palette key.
 * The bootstrap layer (`bootThemePalette`) applies the palette as CSS
 * variables on `:root[data-palette="<key>"]` so existing rules pick them up.
 */

export interface ThemePalette {
  key: string
  label: string
  /** Default mode hint — users can still override via the light/dark/system toggle. */
  preferredMode: 'light' | 'dark'
  /** Vars that get written onto the document root when the palette is active. */
  vars: {
    /** Sidebar background colour. */
    '--mm-sidebar-bg': string
    /** Sidebar text — primary state. */
    '--mm-sidebar-text': string
    /** Sidebar text — active/selected state. */
    '--mm-sidebar-text-active': string
    /** Sidebar text — hover state. */
    '--mm-sidebar-text-hover': string
    /** Sidebar header (workspace name) bg. */
    '--mm-sidebar-header-bg': string
    /** Selected-channel pill bg. */
    '--mm-sidebar-active-bg': string
    /** Mention badge bg. */
    '--mm-sidebar-mention-bg': string
    /** Workspace rail icon bg. */
    '--aae-workspace-rail-bg': string
    /** Accent — used for unread underlines, link underline. */
    '--aae-link': string
  }
}

export const PALETTES: readonly ThemePalette[] = [
  {
    key: 'default-light',
    label: 'Default · Light',
    preferredMode: 'light',
    vars: {
      '--mm-sidebar-bg': '#3F0E40',
      '--mm-sidebar-text': '#bcabbc',
      '--mm-sidebar-text-active': '#ffffff',
      '--mm-sidebar-text-hover': '#ffffff',
      '--mm-sidebar-header-bg': '#350D36',
      '--mm-sidebar-active-bg': '#1164A3',
      '--mm-sidebar-mention-bg': '#cd2553',
      '--aae-workspace-rail-bg': '#350D36',
      '--aae-link': '#1264A3',
    },
  },
  {
    key: 'default-dark',
    label: 'Default · Dark',
    preferredMode: 'dark',
    vars: {
      '--mm-sidebar-bg': '#19171D',
      '--mm-sidebar-text': '#9da2a6',
      '--mm-sidebar-text-active': '#ffffff',
      '--mm-sidebar-text-hover': '#ffffff',
      '--mm-sidebar-header-bg': '#0D0D0F',
      '--mm-sidebar-active-bg': '#1164A3',
      '--mm-sidebar-mention-bg': '#cd2553',
      '--aae-workspace-rail-bg': '#0D0D0F',
      '--aae-link': '#36C5F0',
    },
  },
  {
    key: 'aubergine',
    label: 'Aubergine',
    preferredMode: 'light',
    vars: {
      '--mm-sidebar-bg': '#4D394B',
      '--mm-sidebar-text': '#ab9ba9',
      '--mm-sidebar-text-active': '#FFFFFF',
      '--mm-sidebar-text-hover': '#FFFFFF',
      '--mm-sidebar-header-bg': '#3E313C',
      '--mm-sidebar-active-bg': '#4C9689',
      '--mm-sidebar-mention-bg': '#EB4D5C',
      '--aae-workspace-rail-bg': '#3E313C',
      '--aae-link': '#1264A3',
    },
  },
  {
    key: 'banana',
    label: 'Banana',
    preferredMode: 'light',
    vars: {
      '--mm-sidebar-bg': '#F5BE49',
      '--mm-sidebar-text': '#A87E04',
      '--mm-sidebar-text-active': '#3D2A00',
      '--mm-sidebar-text-hover': '#1f1300',
      '--mm-sidebar-header-bg': '#E8AB28',
      '--mm-sidebar-active-bg': '#FF9900',
      '--mm-sidebar-mention-bg': '#FF5733',
      '--aae-workspace-rail-bg': '#E8AB28',
      '--aae-link': '#0050B3',
    },
  },
  {
    key: 'forest',
    label: 'Forest',
    preferredMode: 'dark',
    vars: {
      '--mm-sidebar-bg': '#1F3D2B',
      '--mm-sidebar-text': '#a3c5b0',
      '--mm-sidebar-text-active': '#FFFFFF',
      '--mm-sidebar-text-hover': '#FFFFFF',
      '--mm-sidebar-header-bg': '#0F2615',
      '--mm-sidebar-active-bg': '#54A26A',
      '--mm-sidebar-mention-bg': '#E6735C',
      '--aae-workspace-rail-bg': '#0F2615',
      '--aae-link': '#2EB489',
    },
  },
  {
    key: 'hoth',
    label: 'Hoth',
    preferredMode: 'light',
    vars: {
      '--mm-sidebar-bg': '#F8F8F8',
      '--mm-sidebar-text': '#4f5660',
      '--mm-sidebar-text-active': '#0F1419',
      '--mm-sidebar-text-hover': '#0F1419',
      '--mm-sidebar-header-bg': '#E8E8E8',
      '--mm-sidebar-active-bg': '#1264A3',
      '--mm-sidebar-mention-bg': '#cd2553',
      '--aae-workspace-rail-bg': '#E8E8E8',
      '--aae-link': '#1264A3',
    },
  },
  {
    key: 'mint',
    label: 'Mint',
    preferredMode: 'light',
    vars: {
      '--mm-sidebar-bg': '#86C5BB',
      '--mm-sidebar-text': '#2F4F4A',
      '--mm-sidebar-text-active': '#0E1F1B',
      '--mm-sidebar-text-hover': '#0E1F1B',
      '--mm-sidebar-header-bg': '#5BAFA5',
      '--mm-sidebar-active-bg': '#1A7A6A',
      '--mm-sidebar-mention-bg': '#D74A4A',
      '--aae-workspace-rail-bg': '#5BAFA5',
      '--aae-link': '#0F4F4A',
    },
  },
  {
    key: 'nocturne',
    label: 'Nocturne',
    preferredMode: 'dark',
    vars: {
      '--mm-sidebar-bg': '#0F1B2C',
      '--mm-sidebar-text': '#7E91A8',
      '--mm-sidebar-text-active': '#FFFFFF',
      '--mm-sidebar-text-hover': '#E2EDF7',
      '--mm-sidebar-header-bg': '#08111D',
      '--mm-sidebar-active-bg': '#36C5F0',
      '--mm-sidebar-mention-bg': '#E6735C',
      '--aae-workspace-rail-bg': '#08111D',
      '--aae-link': '#36C5F0',
    },
  },
  {
    key: 'ochin',
    label: 'Ochin',
    preferredMode: 'light',
    vars: {
      '--mm-sidebar-bg': '#303E4D',
      '--mm-sidebar-text': '#9ba9bb',
      '--mm-sidebar-text-active': '#FFFFFF',
      '--mm-sidebar-text-hover': '#FFFFFF',
      '--mm-sidebar-header-bg': '#1F2A36',
      '--mm-sidebar-active-bg': '#3CB593',
      '--mm-sidebar-mention-bg': '#EB4D5C',
      '--aae-workspace-rail-bg': '#1F2A36',
      '--aae-link': '#3CB593',
    },
  },
  {
    key: 'terminal',
    label: 'Terminal',
    preferredMode: 'dark',
    vars: {
      '--mm-sidebar-bg': '#000000',
      '--mm-sidebar-text': '#888888',
      '--mm-sidebar-text-active': '#33FF33',
      '--mm-sidebar-text-hover': '#33FF33',
      '--mm-sidebar-header-bg': '#000000',
      '--mm-sidebar-active-bg': '#003300',
      '--mm-sidebar-mention-bg': '#FF3333',
      '--aae-workspace-rail-bg': '#000000',
      '--aae-link': '#33FF33',
    },
  },
  {
    key: 'wartocks',
    label: 'Wartocks',
    preferredMode: 'dark',
    vars: {
      '--mm-sidebar-bg': '#222F3E',
      '--mm-sidebar-text': '#7d8a99',
      '--mm-sidebar-text-active': '#ffffff',
      '--mm-sidebar-text-hover': '#ffffff',
      '--mm-sidebar-header-bg': '#1A2532',
      '--mm-sidebar-active-bg': '#FF7A45',
      '--mm-sidebar-mention-bg': '#FF4D4F',
      '--aae-workspace-rail-bg': '#1A2532',
      '--aae-link': '#FF7A45',
    },
  },
  {
    key: 'workhaus',
    label: 'Workhaus',
    preferredMode: 'light',
    vars: {
      '--mm-sidebar-bg': '#0E1419',
      '--mm-sidebar-text': '#727a82',
      '--mm-sidebar-text-active': '#FFD86E',
      '--mm-sidebar-text-hover': '#FFD86E',
      '--mm-sidebar-header-bg': '#020608',
      '--mm-sidebar-active-bg': '#FFD86E',
      '--mm-sidebar-mention-bg': '#FF5C5C',
      '--aae-workspace-rail-bg': '#020608',
      '--aae-link': '#FFD86E',
    },
  },
] as const

const STORAGE_KEY = 'aaelink-theme-palette'

export function readPalettePreference(): string {
  if (typeof window === 'undefined') return 'default-light'
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v && PALETTES.some(p => p.key === v)) return v
  } catch { /* noop */ }
  return 'default-light'
}

export function persistPalettePreference(key: string) {
  if (typeof window === 'undefined') return
  if (!PALETTES.some(p => p.key === key)) return
  try {
    localStorage.setItem(STORAGE_KEY, key)
  } catch { /* noop */ }
  applyPalette(key)
}

export function applyPalette(key: string) {
  if (typeof document === 'undefined') return
  const palette = PALETTES.find(p => p.key === key) ?? PALETTES[0]
  const root = document.documentElement
  root.setAttribute('data-palette', palette.key)
  for (const [name, value] of Object.entries(palette.vars)) {
    root.style.setProperty(name, value)
  }
}

export function bootThemePalette(): () => void {
  if (typeof window === 'undefined') return () => {}
  applyPalette(readPalettePreference())
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) applyPalette(readPalettePreference())
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}
