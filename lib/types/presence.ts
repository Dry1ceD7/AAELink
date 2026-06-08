/**
 * Presence model shared across the chat surface (sidebar, ChatMessage avatar
 * dots, profile panes). This is the canonical source of presence states and
 * their visual treatment so every renderer agrees on colors and labels.
 */

export type Presence = 'active' | 'away' | 'dnd' | 'offline'

export interface CustomStatus {
  emoji?: string
  text?: string
}

/**
 * Resolve the dot color for a presence state.
 * - active  → solid green (#31a24c)
 * - away    → transparent fill (renderers add a ring outline)
 * - dnd     → red (#e01e5a)
 * - offline → muted grey (#9aa1ad)
 */
export function presenceColor(p: Presence): string {
  switch (p) {
    case 'active':
      return '#31a24c'
    case 'away':
      return 'transparent'
    case 'dnd':
      return '#e01e5a'
    case 'offline':
    default:
      return '#9aa1ad'
  }
}

/** Human-readable label for a presence state. */
export function presenceLabel(p: Presence): string {
  switch (p) {
    case 'active':
      return 'Active'
    case 'away':
      return 'Away'
    case 'dnd':
      return 'Do not disturb'
    case 'offline':
    default:
      return 'Offline'
  }
}
