/**
 * AAELink — Slash Commands Parser & Registry Exhaustive Tests
 */
import { describe, it, expect } from 'vitest'
import { parseSlashCommand, getSlashCommands, executeSlashCommand } from '@/lib/comms/slashCommands'

// ── parseSlashCommand ───────────────────────────────────────────────

describe('SlashCommands — parseSlashCommand — basic', () => {
  it('parses simple command', () => {
    expect(parseSlashCommand('/shrug')).toEqual({ name: 'shrug', args: '' })
  })
  it('parses command with args', () => {
    expect(parseSlashCommand('/shrug hello world')).toEqual({ name: 'shrug', args: 'hello world' })
  })
  it('normalizes to lowercase', () => {
    expect(parseSlashCommand('/STATUS busy')).toEqual({ name: 'status', args: 'busy' })
  })
  it('handles ALLCAPS', () => {
    expect(parseSlashCommand('/HELP')).toEqual({ name: 'help', args: '' })
  })
  it('handles MixedCase', () => {
    expect(parseSlashCommand('/Shrug test')).toEqual({ name: 'shrug', args: 'test' })
  })
})

describe('SlashCommands — parseSlashCommand — invalid inputs', () => {
  it('returns null for non-slash message', () => {
    expect(parseSlashCommand('hello world')).toBeNull()
  })
  it('returns null for empty input', () => {
    expect(parseSlashCommand('')).toBeNull()
  })
  it('returns null for whitespace only', () => {
    expect(parseSlashCommand('   ')).toBeNull()
  })
  it('returns null for just a slash', () => {
    expect(parseSlashCommand('/')).toBeNull()
  })
  it('returns null for slash with spaces', () => {
    expect(parseSlashCommand('/ ')).toBeNull()
  })
})

describe('SlashCommands — parseSlashCommand — edge cases', () => {
  it('handles leading whitespace', () => {
    expect(parseSlashCommand('  /help')).toEqual({ name: 'help', args: '' })
  })
  it('handles multiline args', () => {
    const r = parseSlashCommand('/remind 30 Review\nthe PR')
    expect(r?.name).toBe('remind')
    expect(r?.args).toContain('Review')
  })
  it('preserves args whitespace', () => {
    const r = parseSlashCommand('/shrug   lots   of   spaces')
    expect(r?.args).toBe('  lots   of   spaces')
  })
  it('handles special characters in args', () => {
    const r = parseSlashCommand('/status :wave: Hello! @everyone')
    expect(r?.name).toBe('status')
    expect(r?.args).toContain(':wave:')
    expect(r?.args).toContain('@everyone')
  })
})

// ── getSlashCommands ────────────────────────────────────────────────

describe('SlashCommands — getSlashCommands — registry', () => {
  const cmds = getSlashCommands()
  const names = cmds.map(c => c.name)

  it('returns 18+ commands', () => {
    expect(cmds.length).toBeGreaterThanOrEqual(18)
  })

  it('each command has name, description, usage', () => {
    for (const c of cmds) {
      expect(c.name).toBeTruthy()
      expect(c.description).toBeTruthy()
      expect(c.usage).toBeTruthy()
    }
  })

  it.each([
    'shrug', 'tableflip', 'unflip', 'me', 'status', 'dnd',
    'mute', 'unmute', 'remind', 'help', 'topic', 'join',
    'invite', 'collapse', 'expand', 'archive', 'unarchive',
    'rename', 'who',
  ])('includes /%s', (name) => {
    expect(names).toContain(name)
  })

  it('usage starts with /<name>', () => {
    for (const c of cmds) {
      expect(c.usage).toMatch(new RegExp(`^/${c.name}`))
    }
  })

  it('names are lowercase without spaces', () => {
    for (const c of cmds) {
      expect(c.name).toMatch(/^[a-z]+$/)
    }
  })
})

// ── executeSlashCommand — emoji/kaomoji commands ────────────────────

describe('SlashCommands — executeSlashCommand — kaomoji', () => {
  it('/shrug appends shrug face', async () => {
    const r = await executeSlashCommand('shrug', 'test', 'ch-1')
    expect(r?.action).toBe('send')
    expect(r?.text).toContain('¯\\_')
    expect(r?.text).toContain('test')
  })

  it('/shrug with no args', async () => {
    const r = await executeSlashCommand('shrug', '', 'ch-1')
    expect(r?.action).toBe('send')
    expect(r?.text).toContain('¯\\_')
  })

  it('/tableflip appends table flip', async () => {
    const r = await executeSlashCommand('tableflip', '', 'ch-1')
    expect(r?.action).toBe('send')
    expect(r?.text).toContain('┻━┻')
  })

  it('/tableflip with message', async () => {
    const r = await executeSlashCommand('tableflip', 'angry', 'ch-1')
    expect(r?.text).toContain('angry')
    expect(r?.text).toContain('┻━┻')
  })

  it('/unflip appends unflip', async () => {
    const r = await executeSlashCommand('unflip', '', 'ch-1')
    expect(r?.action).toBe('send')
    expect(r?.text).toContain('┬─┬')
  })

  it('/unflip with message', async () => {
    const r = await executeSlashCommand('unflip', 'calm', 'ch-1')
    expect(r?.text).toContain('calm')
    expect(r?.text).toContain('┬─┬')
  })
})

// ── executeSlashCommand — /me ───────────────────────────────────────

describe('SlashCommands — executeSlashCommand — /me', () => {
  it('wraps action in italics', async () => {
    const r = await executeSlashCommand('me', 'dances', 'ch-1')
    expect(r?.action).toBe('send')
    expect(r?.text).toBe('_dances_')
  })

  it('trims action text', async () => {
    const r = await executeSlashCommand('me', '  waves  ', 'ch-1')
    expect(r?.text).toBe('_waves_')
  })

  it('shows usage for empty args', async () => {
    const r = await executeSlashCommand('me', '', 'ch-1')
    expect(r?.action).toBe('ephemeral')
    expect(r?.text).toContain('Usage')
  })

  it('shows usage for whitespace-only args', async () => {
    const r = await executeSlashCommand('me', '   ', 'ch-1')
    expect(r?.action).toBe('ephemeral')
    expect(r?.text).toContain('Usage')
  })
})

// ── executeSlashCommand — ephemeral commands ────────────────────────

describe('SlashCommands — executeSlashCommand — ephemeral', () => {
  it('/collapse returns ephemeral', async () => {
    const r = await executeSlashCommand('collapse', '', 'ch-1')
    expect(r?.action).toBe('ephemeral')
    expect(r?.text).toContain('collapsed')
  })

  it('/expand returns ephemeral', async () => {
    const r = await executeSlashCommand('expand', '', 'ch-1')
    expect(r?.action).toBe('ephemeral')
    expect(r?.text).toContain('expanded')
  })

  it('/help returns list of commands', async () => {
    const r = await executeSlashCommand('help', '', 'ch-1')
    expect(r?.action).toBe('ephemeral')
    expect(r?.text).toContain('Available commands')
    expect(r?.text).toContain('/shrug')
    expect(r?.text).toContain('/help')
  })
})

// ── executeSlashCommand — unknown ───────────────────────────────────

describe('SlashCommands — executeSlashCommand — unknown', () => {
  it('returns null for unknown command', async () => {
    expect(await executeSlashCommand('nonexistent', '', 'ch-1')).toBeNull()
  })

  it('returns null for empty name', async () => {
    expect(await executeSlashCommand('', '', 'ch-1')).toBeNull()
  })
})
