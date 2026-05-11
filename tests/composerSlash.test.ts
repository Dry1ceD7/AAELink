/**
 * AAELink — Composer Slash Expansion Tests
 */
import { describe, it, expect } from 'vitest'
import { expandComposerSlash, type SlashMeUser } from '@/lib/composerSlash'

const testUser: SlashMeUser = {
  username: 'alice',
  first_name: 'Alice',
  last_name: 'Smith',
}

describe('ComposerSlash — Basic text', () => {
  it('non-slash message passes through', () => {
    const r = expandComposerSlash('hello world', testUser)
    expect(r).toEqual({ kind: 'send', text: 'hello world' })
  })
})

describe('ComposerSlash — /shrug', () => {
  it('bare /shrug', () => {
    const r = expandComposerSlash('/shrug', null)
    expect(r.kind).toBe('send')
    if (r.kind === 'send') expect(r.text).toContain('_(ツ)_')
  })
  it('/shrug with text', () => {
    const r = expandComposerSlash('/shrug oh well', null)
    if (r.kind === 'send') {
      expect(r.text).toContain('oh well')
      expect(r.text).toContain('_(ツ)_')
    }
  })
})

describe('ComposerSlash — /tableflip & /unflip', () => {
  it('/tableflip', () => {
    const r = expandComposerSlash('/tableflip', null)
    if (r.kind === 'send') expect(r.text).toContain('┻━┻')
  })
  it('/unflip', () => {
    const r = expandComposerSlash('/unflip', null)
    if (r.kind === 'send') expect(r.text).toContain('┬─┬')
  })
})

describe('ComposerSlash — /me', () => {
  it('/me with action text', () => {
    const r = expandComposerSlash('/me is coding', testUser)
    if (r.kind === 'send') {
      expect(r.text).toBe('_Alice Smith is coding_')
    }
  })
  it('/me without text uses display name', () => {
    const r = expandComposerSlash('/me', testUser)
    if (r.kind === 'send') expect(r.text).toBe('_Alice Smith_')
  })
  it('/me without user passes through', () => {
    const r = expandComposerSlash('/me test', null)
    expect(r).toEqual({ kind: 'send', text: '/me test' })
  })
})

describe('ComposerSlash — /clear & /shortcuts', () => {
  it('/clear → clear-draft', () => {
    expect(expandComposerSlash('/clear', null)).toEqual({ kind: 'clear-draft' })
  })
  it('/shortcuts → open-shortcuts', () => {
    expect(expandComposerSlash('/shortcuts', null)).toEqual({ kind: 'open-shortcuts' })
  })
})

describe('ComposerSlash — /code', () => {
  it('/code with content → set-draft', () => {
    const r = expandComposerSlash('/code const x = 1', null)
    expect(r.kind).toBe('set-draft')
    if (r.kind === 'set-draft') {
      expect(r.text).toContain('```')
      expect(r.text).toContain('const x = 1')
    }
  })
  it('/code bare → empty block', () => {
    const r = expandComposerSlash('/code', null)
    expect(r.kind).toBe('set-draft')
  })
})

describe('ComposerSlash — Async commands', () => {
  it('/status → async-command', () => {
    const r = expandComposerSlash('/status :smile: working', null)
    expect(r).toEqual({ kind: 'async-command', name: 'status', args: ':smile: working' })
  })
  it('/dnd → async-command', () => {
    const r = expandComposerSlash('/dnd 30', null)
    expect(r).toEqual({ kind: 'async-command', name: 'dnd', args: '30' })
  })
  it('/mute → async-command', () => {
    expect(expandComposerSlash('/mute', null).kind).toBe('async-command')
  })
  it('/remind → async-command', () => {
    const r = expandComposerSlash('/remind 15 review PR', null)
    expect(r.kind).toBe('async-command')
    if (r.kind === 'async-command') expect(r.args).toBe('15 review PR')
  })
  it('/help → async-command', () => {
    expect(expandComposerSlash('/help', null).kind).toBe('async-command')
  })
})

describe('ComposerSlash — Unknown commands', () => {
  it('unknown /xyz passes through as send', () => {
    const r = expandComposerSlash('/xyz hello', null)
    expect(r).toEqual({ kind: 'send', text: '/xyz hello' })
  })
})
