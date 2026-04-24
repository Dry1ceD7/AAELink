'use client'

import { useEffect } from 'react'

import { usePreferences } from '@/lib/settings-store'

// Reflect persisted preferences onto the document root so global CSS
// selectors can react. Drop in once at app shell level — keeps the
// preference store as the single source of truth without coupling each
// consumer to the DOM.
export function PreferencesApplier() {
  const prefs = usePreferences()

  useEffect(() => {
    const root = document.documentElement
    root.dataset.density = prefs.density
    root.dataset.reduceMotion = prefs.reduceMotion ? 'true' : 'false'
  }, [prefs.density, prefs.reduceMotion])

  return null
}
