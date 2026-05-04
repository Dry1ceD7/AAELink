/** Slash-style composer commands (Slack / Mattermost inspired). */

export type SlashMeUser = {
  username: string
  first_name?: string
  last_name?: string
  nickname?: string
}

function collabDisplayName(u: SlashMeUser): string {
  const full = `${u.first_name || ''} ${u.last_name || ''}`.trim()
  if (full) return full
  if (u.nickname) return u.nickname
  return u.username
}

const SHRUG = '¯\\_(ツ)_/¯'
const TABLEFLIP = '(╯°□°)╯︵ ┻━┻'
const UNFLIP = '┬─┬ ノ( ゜-゜ノ)'

export type ExpandSlashResult =
  | { kind: 'send'; text: string }
  | { kind: 'clear-draft' }
  | { kind: 'open-shortcuts' }
  | { kind: 'set-draft'; text: string; selectionStart: number; selectionEnd: number }
  | { kind: 'async-command'; name: string; args: string }

/** Async slash commands that require API calls. */
const ASYNC_COMMANDS = ['status', 'dnd', 'mute', 'unmute', 'remind', 'help']

/**
 * If the trimmed message starts with `/`, apply local expansions; otherwise return as-is.
 */
export function expandComposerSlash(trimmed: string, me: SlashMeUser | null): ExpandSlashResult {
  const t = trimmed
  if (!t.startsWith('/')) return { kind: 'send', text: t }

  if (t === '/clear') return { kind: 'clear-draft' }
  if (t === '/shortcuts') return { kind: 'open-shortcuts' }

  const meMatch = t.match(/^\/me(?:\s+(.*))?$/s)
  if (meMatch) {
    if (!me) return { kind: 'send', text: t }
    const rest = (meMatch[1] ?? '').trim()
    const name = collabDisplayName(me)
    if (!rest) return { kind: 'send', text: `_${name}_` }
    return { kind: 'send', text: `_${name} ${rest}_` }
  }

  const shrugMatch = t.match(/^\/shrug(?:\s+(.*))?$/)
  if (shrugMatch) {
    const tail = (shrugMatch[1] ?? '').trim()
    return { kind: 'send', text: tail ? `${tail} ${SHRUG}` : SHRUG }
  }

  const tableflipMatch = t.match(/^\/tableflip(?:\s+(.*))?$/)
  if (tableflipMatch) {
    const tail = (tableflipMatch[1] ?? '').trim()
    return { kind: 'send', text: tail ? `${tail} ${TABLEFLIP}` : TABLEFLIP }
  }

  const unflipMatch = t.match(/^\/unflip(?:\s+(.*))?$/)
  if (unflipMatch) {
    const tail = (unflipMatch[1] ?? '').trim()
    return { kind: 'send', text: tail ? `${tail} ${UNFLIP}` : UNFLIP }
  }

  const codeMatch = t.match(/^\/code(?:\s+(.*))?$/s)
  if (codeMatch) {
    const inner = (codeMatch[1] ?? '').trim()
    if (inner) {
      const body = `\`\`\`\n${inner}\n\`\`\``
      const caret = 4 + inner.length
      return { kind: 'set-draft', text: body, selectionStart: caret, selectionEnd: caret }
    }
    const body = '```\n\n```'
    return { kind: 'set-draft', text: body, selectionStart: 4, selectionEnd: 4 }
  }

  // Check for async commands that need API calls
  const spaceIdx = t.indexOf(' ')
  const cmdName = spaceIdx > 0 ? t.slice(1, spaceIdx).toLowerCase() : t.slice(1).toLowerCase()
  const cmdArgs = spaceIdx > 0 ? t.slice(spaceIdx + 1) : ''

  if (ASYNC_COMMANDS.includes(cmdName)) {
    return { kind: 'async-command', name: cmdName, args: cmdArgs }
  }

  return { kind: 'send', text: t }
}

