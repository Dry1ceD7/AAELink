/** Detect @username fragment immediately before the cursor (Slack-style mentions). */

/** Characters allowed in an @handle while typing (Unicode letters/digits, plus, dot, underscore, hyphen). */
const MENTION_PREFIX_RE = /@([\p{L}\p{N}_.+\-]*)$/u

export type MentionPrefix = { atIndex: number; query: string }

export type MentionInsertResult = { text: string; selectionStart: number; selectionEnd: number }

export function mentionPrefixAtCursor(text: string, cursor: number): MentionPrefix | null {
  const c = Math.max(0, Math.min(cursor, text.length))
  const before = text.slice(0, c)
  const m = before.match(MENTION_PREFIX_RE)
  if (!m || m.index === undefined) return null
  return { atIndex: m.index, query: m[1] ?? '' }
}

export function applyMentionPick(text: string, atIndex: number, cursor: number, username: string): MentionInsertResult {
  const uname = username.replace(/^@+/, '')
  const before = text.slice(0, atIndex)
  const after = text.slice(cursor)
  const insert = `@${uname} `
  const next = before + insert + after
  const pos = before.length + insert.length
  return { text: next, selectionStart: pos, selectionEnd: pos }
}
