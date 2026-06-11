'use client'

import { useLayoutEffect } from 'react'
import { bootPreferences } from '@/lib/ui/userPreferences'

/**
 * Boots the user preferences engine on every page load.
 * Applies CSS side-effects (scale, contrast, motion, accent, density)
 * before the first paint.
 */
export function PreferencesBoot() {
  useLayoutEffect(() => {
    bootPreferences()
  }, [])
  return null
}
