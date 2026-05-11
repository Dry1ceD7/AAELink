/** Allowed reaction keys (Lucide-mapped in UI; no emoji characters). */
export const REACTION_KEYS = ['thumbs_up', 'heart', 'check', 'smile', 'eye'] as const

export type ReactionKey = (typeof REACTION_KEYS)[number]

export function isAllowedReactionKey(s: string): s is ReactionKey {
  return (REACTION_KEYS as readonly string[]).includes(s)
}

export type ReactionSummary = { key: string; count: number; me: boolean }

/** Map legacy Lucide reaction keys to native emoji for display. */
export const REACTION_EMOJI_MAP: Record<ReactionKey, string> = {
  thumbs_up: '👍',
  heart: '❤️',
  check: '✅',
  smile: '😄',
  eye: '👀'
}

/**
 * Validate a reaction key. Accepts:
 * - Legacy short keys (thumbs_up, heart, etc.)
 * - Single native emoji (1-8 codepoints)
 * - Max 20 characters
 */
export function isValidReactionKey(s: string): boolean {
  if (!s || s.length > 20) return false
  if (isAllowedReactionKey(s)) return true
  // Accept any single emoji or short emoji sequence (skin tones, ZWJ sequences, etc.)
  // Simple heuristic: if it contains only emoji-range codepoints
  const emojiPattern = /^[\p{Emoji_Presentation}\p{Emoji}\u200d\ufe0f]+$/u
  return emojiPattern.test(s)
}

/** Resolve a reaction key to a display string (emoji). */
export function reactionToEmoji(key: string): string {
  if (isAllowedReactionKey(key)) return REACTION_EMOJI_MAP[key]
  return key // Already an emoji
}
