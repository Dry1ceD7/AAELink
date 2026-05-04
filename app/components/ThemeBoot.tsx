'use client'

import { useEffect, useLayoutEffect } from 'react'
import { bootTheme, readThemePreference, applyTheme } from '@/lib/theme'

/** Applies saved theme preference before first paint on any route. */
export function ThemeBoot() {
  // Synchronous apply for FOUC prevention
  useLayoutEffect(() => {
    applyTheme(readThemePreference())
  }, [])

  // Async listener for OS theme changes
  useEffect(() => {
    return bootTheme()
  }, [])

  return null
}
