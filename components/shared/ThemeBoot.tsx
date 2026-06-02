'use client'

import { useEffect, useLayoutEffect } from 'react'
import { bootTheme, readThemePreference, applyTheme } from '@/lib/ui/theme'
import { applyPalette, bootThemePalette, readPalettePreference } from '@/lib/ui/themePalette'

/** Applies saved theme preference before first paint on any route. */
export function ThemeBoot() {
  // Synchronous apply for FOUC prevention — runs before first paint.
  useLayoutEffect(() => {
    applyTheme(readThemePreference())
    applyPalette(readPalettePreference())
  }, [])

  // Async listeners for OS theme changes / cross-tab palette sync.
  useEffect(() => {
    const offTheme = bootTheme()
    const offPalette = bootThemePalette()
    return () => { offTheme(); offPalette() }
  }, [])

  return null
}
