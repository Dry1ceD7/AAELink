/** @-handles in message bodies (Slack-style; Unicode + plus allowed, max 64 chars after @). */
const MENTION_RE = /@([\p{L}\p{N}_.+\-]{1,64})/gu

export function parseMentionUsernames(body: string): string[] {
  const out = new Set<string>()
  let m: RegExpExecArray | null
  const text = String(body || '')
  MENTION_RE.lastIndex = 0
  while ((m = MENTION_RE.exec(text)) !== null) {
    const raw = m[1]?.trim()
    if (raw) out.add(raw.toLowerCase())
  }
  return [...out]
}
