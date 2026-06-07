/** @-handles in message bodies (Slack-style; Unicode + plus allowed, max 64 chars after @). */
const MENTION_RE = /@([\p{L}\p{N}_.+\-]{1,64})/gu

/** Broadcast tokens that are NOT real usernames. */
const BROADCAST_TOKENS = new Set(['here', 'channel', 'everyone', 'all'])

export type BroadcastToken = 'here' | 'channel' | 'everyone'

/**
 * Extract broadcast mention tokens (@here, @channel, @everyone / @all) from a
 * message body. Returns a Set of the canonical forms; 'all' is normalised to
 * 'everyone'. Only the three canonical values are ever present in the result.
 */
export function parseBroadcastMentions(body: string): Set<BroadcastToken> {
  const out = new Set<BroadcastToken>()
  const text = String(body || '')
  MENTION_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MENTION_RE.exec(text)) !== null) {
    const raw = m[1]?.trim().toLowerCase()
    if (raw === 'here') out.add('here')
    else if (raw === 'channel') out.add('channel')
    else if (raw === 'everyone' || raw === 'all') out.add('everyone')
  }
  return out
}

export function parseMentionUsernames(body: string): string[] {
  const out = new Set<string>()
  let m: RegExpExecArray | null
  const text = String(body || '')
  MENTION_RE.lastIndex = 0
  while ((m = MENTION_RE.exec(text)) !== null) {
    const raw = m[1]?.trim()
    if (raw && !BROADCAST_TOKENS.has(raw.toLowerCase())) out.add(raw.toLowerCase())
  }
  return [...out]
}
