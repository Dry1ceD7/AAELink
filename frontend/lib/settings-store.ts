'use client'

import { useSyncExternalStore } from 'react'

// AAELink user preferences. Persisted in localStorage so each PC keeps its
// own appearance / notification choices. Backend-side preferences (per-user
// email opt-in, etc.) are mirrored on the server when the API supports it
// — for now we treat localStorage as the source of truth and degrade
// gracefully if storage is unavailable.

export type DensityMode = 'comfortable' | 'compact'
export type SidebarMode = 'expanded' | 'collapsed'
export type StartPage = 'dashboard' | 'tickets'

export interface AppPreferences {
  density: DensityMode
  sidebar: SidebarMode
  startPage: StartPage
  notifyDesktop: boolean
  notifyEmail: boolean
  notifySounds: boolean
  reduceMotion: boolean
  showSeconds: boolean
}

const DEFAULTS: AppPreferences = {
  density: 'comfortable',
  sidebar: 'expanded',
  startPage: 'dashboard',
  notifyDesktop: true,
  notifyEmail: false,
  notifySounds: false,
  reduceMotion: false,
  showSeconds: false,
}

const KEY = 'aae_prefs_v1'
const listeners = new Set<() => void>()

function read(): AppPreferences {
  if (typeof window === 'undefined') return DEFAULTS
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<AppPreferences>
    return { ...DEFAULTS, ...parsed }
  } catch {
    return DEFAULTS
  }
}

function write(prefs: AppPreferences) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // ignore quota errors
  }
}

let snapshot: AppPreferences | null = null
function getSnapshot(): AppPreferences {
  if (snapshot === null) snapshot = read()
  return snapshot
}

function emit() {
  for (const fn of listeners) fn()
}

export function setPreferences(patch: Partial<AppPreferences>) {
  const next: AppPreferences = { ...getSnapshot(), ...patch }
  snapshot = next
  write(next)
  emit()
}

export function resetPreferences() {
  snapshot = { ...DEFAULTS }
  write(snapshot)
  emit()
}

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

const serverSnapshot = () => DEFAULTS

export function usePreferences(): AppPreferences {
  return useSyncExternalStore(subscribe, getSnapshot, serverSnapshot)
}
