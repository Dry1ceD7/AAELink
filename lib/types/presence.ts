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
 * Server-derived presence fan-out payload.
 *
 * Emitted on the global presence topic and returned by the presence stream.
 * `status` is derived server-side from the manual user_status row + last_seen
 * recency (see app/api/collab/presence/route.ts):
 *   - dnd     → manual DND is active now
 *   - away    → last_seen older than ~10 minutes
 *   - active  → recently seen
 *   - offline → never seen / no heartbeat
 *
 * `custom_emoji` / `custom_text` are user-supplied custom status (user data).
 * An expired custom status (`expires_at > 0` and in the past) is treated as
 * cleared — both emoji and text come back empty and `expires_at` is 0.
 */
export interface PresencePayload {
  user_id: string
  status: Presence
  custom_emoji: string
  custom_text: string
  expires_at: number
  last_seen: number
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
