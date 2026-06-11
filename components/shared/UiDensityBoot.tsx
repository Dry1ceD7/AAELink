'use client'

import { useLayoutEffect } from 'react'
import { applyUiDensity } from '@/lib/ui/uiDensity'

/** Applies saved sidebar/editor density before first paint on any route. */
export function UiDensityBoot() {
  useLayoutEffect(() => {
    applyUiDensity()
  }, [])
  return null
}
