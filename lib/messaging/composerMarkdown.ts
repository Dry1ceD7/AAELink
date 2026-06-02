/** Slack/Mattermost-style markdown helpers for plain-text composers. */

export type ComposerFormatKind = 'bold' | 'italic' | 'code' | 'link' | 'olist' | 'ulist' | 'blockquote'

/** Format kinds handled synchronously by `applyComposerFormat` (link uses `applyComposerLink` + UI). */
export type ComposerFormatKindNoLink = Exclude<ComposerFormatKind, 'link'>

export type ComposerFormatResult = { text: string; selectionStart: number; selectionEnd: number }

function replaceRange(text: string, start: number, end: number, insert: string): string {
  return text.slice(0, start) + insert + text.slice(end)
}

export function applyComposerFormat(
  text: string,
  selStart: number,
  selEnd: number,
  kind: ComposerFormatKindNoLink
): ComposerFormatResult | null {
  const start = Math.max(0, Math.min(selStart, text.length))
  const end = Math.max(start, Math.min(selEnd, text.length))
  const selected = text.slice(start, end)
  let insert = ''
  let caretStart = start
  let caretEnd = start

  if (kind === 'bold') {
    const inner = selected || 'bold'
    insert = `**${inner}**`
    caretStart = start + 2
    caretEnd = caretStart + inner.length
  } else if (kind === 'italic') {
    const inner = selected || 'italic'
    insert = `*${inner}*`
    caretStart = start + 1
    caretEnd = caretStart + inner.length
  } else if (kind === 'code') {
    const inner = selected || 'code'
    insert = `\`${inner}\``
    caretStart = start + 1
    caretEnd = caretStart + inner.length
  } else if (kind === 'olist') {
    const block = selected || 'item'
    const lines = block.split('\n')
    const numbered = lines.map((line, i) => `${i + 1}. ${line}`).join('\n')
    insert = numbered
    caretStart = start + insert.length
    caretEnd = caretStart
  } else if (kind === 'ulist') {
    const block = selected || 'item'
    const lines = block.split('\n')
    const bulleted = lines.map(line => `- ${line}`).join('\n')
    insert = bulleted
    caretStart = start + insert.length
    caretEnd = caretStart
  } else if (kind === 'blockquote') {
    const block = selected || 'quote'
    const quoted = block
      .split('\n')
      .map(line => `> ${line}`)
      .join('\n')
    insert = quoted
    caretStart = start + insert.length
    caretEnd = caretStart
  } else {
    return null
  }

  const next = replaceRange(text, start, end, insert)
  return { text: next, selectionStart: caretStart, selectionEnd: caretEnd }
}

/** Insert `[label](url)` at the given range; `label` is selection or the placeholder `link text`. */
export function applyComposerLink(text: string, selStart: number, selEnd: number, url: string): ComposerFormatResult | null {
  const start = Math.max(0, Math.min(selStart, text.length))
  const end = Math.max(start, Math.min(selEnd, text.length))
  const selected = text.slice(start, end)
  const trimmed = String(url).trim()
  if (!trimmed) return null
  const label = selected || 'link text'
  const insert = `[${label}](${trimmed})`
  const caretStart = start + insert.length
  const next = replaceRange(text, start, end, insert)
  return { text: next, selectionStart: caretStart, selectionEnd: caretStart }
}
