/** Allowed reaction keys (Lucide-mapped in UI; no emoji characters). */
export const REACTION_KEYS = ['thumbs_up', 'heart', 'check', 'smile', 'eye'] as const

export type ReactionKey = (typeof REACTION_KEYS)[number]

export function isAllowedReactionKey(s: string): s is ReactionKey {
  return (REACTION_KEYS as readonly string[]).includes(s)
}

export type ReactionSummary = { key: string; count: number; me: boolean }
