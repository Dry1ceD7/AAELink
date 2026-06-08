/**
 * PresenceDot — canonical presence indicator for the chat surface.
 *
 * Renders a CSS-colored dot driven purely by `status` (never an emoji glyph):
 *   - active  → solid green (#2bac76)
 *   - away    → hollow amber ring (transparent fill + amber border)
 *   - dnd     → solid red (#e01e5a)
 *   - offline → solid muted gray (#9aa1ad)
 *
 * The optional custom status (`customEmoji` / `customText`) is USER DATA passed
 * straight through — a user-supplied emoji string is rendered as-is. No emoji
 * literals are hardcoded in this component.
 *
 * Imported by ChatMessage (Slice 1) and the sidebar (Slice 3); it is the single
 * source of truth for presence rendering.
 */

import type { CSSProperties } from 'react'
import type { Presence } from '@/lib/types/presence'

export interface PresenceDotProps {
  status: Presence
  /** User-supplied custom status emoji (user data, rendered verbatim). */
  customEmoji?: string
  /** User-supplied custom status text. */
  customText?: string
  /** Dot diameter in px (default 10). */
  size?: number
}

const ACTIVE_GREEN = '#2bac76'
const AWAY_AMBER = '#e8a820'
const DND_RED = '#e01e5a'
const OFFLINE_GRAY = '#9aa1ad'

/** Resolve fill + border for the dot from the presence status. */
function dotStyle(status: Presence, size: number): CSSProperties {
  const base: CSSProperties = {
    display: 'inline-block',
    width: size,
    height: size,
    borderRadius: '50%',
    boxSizing: 'border-box',
    flexShrink: 0,
  }
  switch (status) {
    case 'active':
      return { ...base, background: ACTIVE_GREEN }
    case 'away':
      // Hollow amber ring: transparent fill + amber border.
      return { ...base, background: 'transparent', border: `2px solid ${AWAY_AMBER}` }
    case 'dnd':
      return { ...base, background: DND_RED }
    case 'offline':
    default:
      return { ...base, background: OFFLINE_GRAY }
  }
}

export function PresenceDot({ status, customEmoji, customText, size = 10 }: PresenceDotProps) {
  const emoji = customEmoji?.trim() || ''
  const text = customText?.trim() || ''
  const hasCustom = emoji.length > 0 || text.length > 0

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span
        role="img"
        aria-label={`presence: ${status}`}
        title={status}
        style={dotStyle(status, size)}
      />
      {hasCustom && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {emoji && (
            <span aria-hidden="true" style={{ lineHeight: 1 }}>
              {emoji}
            </span>
          )}
          {text && (
            <span
              style={{
                fontSize: 12,
                color: 'var(--text-secondary, #616061)',
                maxWidth: 160,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {text}
            </span>
          )}
        </span>
      )}
    </span>
  )
}
