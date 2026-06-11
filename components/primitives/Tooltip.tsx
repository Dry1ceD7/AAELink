'use client'

import type { ReactNode } from 'react'

/**
 * `<Tooltip>` — CSS-only tooltip with 200ms hover delay.
 *
 * Trade-off: no clever positioning (always renders `top` of the trigger). For
 * tooltips that must avoid viewport edges, use a positioning library — but
 * 95% of in-app tooltips are simple labels above icon buttons; the simple
 * version covers them and ships zero JS.
 *
 * Replaces native `title=""` attributes (which have inconsistent timing,
 * styling, and accessibility properties across OS/browser combos).
 */
export interface TooltipProps {
  label: string
  children: ReactNode
  /** Delay override in ms; defaults to 200. */
  delayMs?: number
}

export function Tooltip({ label, children, delayMs }: TooltipProps) {
  // The CSS uses `:hover` to drive the bubble's opacity; the delay is set in
  // the stylesheet (`.ds-tooltip-wrapper:hover ... transition-delay: 200ms`).
  // `delayMs` is reserved for a future override path.
  void delayMs
  return (
    <span className="ds-tooltip-wrapper">
      {children}
      <span role="tooltip" className="ds-tooltip-bubble">{label}</span>
    </span>
  )
}
