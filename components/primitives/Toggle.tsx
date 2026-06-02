'use client'

import type { CSSProperties } from 'react'

/**
 * `<Toggle>` — accessible on/off switch primitive.
 *
 * Replaces the per-panel hand-rolled toggle pills that look like:
 *
 *   <div style={{ width: 44, height: 24, borderRadius: 12, ... }}>
 *     <div style={{ width: 18, height: 18, ... }} />
 *   </div>
 *
 * Same visual outcome, but:
 *   • `role="switch"` + `aria-checked` for screen-reader correctness
 *   • Keyboard activation (Enter / Space) via the underlying `<button>`
 *   • Focus-visible ring (uses the global `:focus-visible` ring shipped
 *     in v0.0.44 instead of inventing one per panel)
 *   • `prefers-reduced-motion` honored — the knob slide collapses to
 *     `transition: none`
 *   • A `disabled` prop that locks input and dims the visual
 *
 * The matching CSS lives at the bottom of `app/styles.css`
 * under `Design System Tokens (v0.0.54 Toggle primitive)`.
 */
export interface ToggleProps {
  checked: boolean
  onChange: (next: boolean) => void
  /** Optional ARIA label for screen readers. */
  ariaLabel?: string
  /** When provided, links via `aria-labelledby` to the visible label. */
  labelledBy?: string
  disabled?: boolean
  /** Render a subtle "danger" tint on the active state. */
  danger?: boolean
  className?: string
  style?: CSSProperties
}

export function Toggle({
  checked,
  onChange,
  ariaLabel,
  labelledBy,
  disabled = false,
  danger = false,
  className = '',
  style,
}: ToggleProps) {
  const classes = [
    'ds-toggle',
    checked ? 'ds-toggle--on' : '',
    danger ? 'ds-toggle--danger' : '',
    disabled ? 'ds-toggle--disabled' : '',
    className,
  ].filter(Boolean).join(' ')

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={labelledBy ? undefined : ariaLabel}
      aria-labelledby={labelledBy}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={() => { if (!disabled) onChange(!checked) }}
      className={classes}
      style={style}
    >
      <span className="ds-toggle-knob" aria-hidden="true" />
    </button>
  )
}
