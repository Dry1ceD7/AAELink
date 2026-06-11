/**
 * `lib/composerSlash.ts` regression suite.
 *
 * Pins the `getClientSlashCommands()` registry so the Composer autocomplete and
 * the `expandComposerSlash()` parser stay in lockstep. Drift between them is
 * the bug v0.0.32 closed.
 */
import { describe, it, expect } from 'vitest'
import {
  expandComposerSlash,
  getClientSlashCommands,
} from '@/lib/messaging/composerSlash'
import { getSlashCommands } from '@/lib/comms/slashCommands'

describe('composerSlash — getClientSlashCommands', () => {
  const client = getClientSlashCommands()
  const clientNames = client.map(c => c.name)

  it('contains exactly the seven client-handled slash commands', () => {
    expect(clientNames.sort()).toEqual(
      ['clear', 'code', 'me', 'shortcuts', 'shrug', 'tableflip', 'unflip'].sort()
    )
  })

  it('every entry has a non-empty name, description, and usage', () => {
    for (const c of client) {
      expect(c.name.length).toBeGreaterThan(0)
      expect(c.description.length).toBeGreaterThan(0)
      expect(c.usage.startsWith('/')).toBe(true)
      expect(c.usage.includes(c.name)).toBe(true)
    }
  })

  it('does not duplicate names', () => {
    expect(new Set(clientNames).size).toBe(clientNames.length)
  })

  it('every client command name is actually intercepted by expandComposerSlash', () => {
    // For each client-only name, expanding should NOT return `kind: 'send'` of
    // the raw text — it should be intercepted into a more specific kind.
    const me = { username: 'tester', first_name: 'T', last_name: 'Test' }
    for (const c of client) {
      const result = expandComposerSlash(`/${c.name}`, me)
      // Allow `send` for shrug/tableflip/unflip (they expand text in `kind: 'send'`)
      // and for `me` (renders italics). The bug we're guarding against is the
      // command name silently dropping through to the lib registry as
      // `async-command`, which would happen if the name was missing here.
      expect(result.kind).not.toBe('async-command')
    }
  })
})

describe('composerSlash — overlap with lib/slashCommands.ts', () => {
  it('client and lib registries together cover the full Slack-parity surface', () => {
    const client = getClientSlashCommands().map(c => c.name)
    const lib = getSlashCommands().map(c => c.name)
    const union = new Set([...client, ...lib])
    // Sanity floor: at least the 12 commands shipped at v0.0.31.
    expect(union.size).toBeGreaterThanOrEqual(12)
  })

  it('shrug / tableflip / unflip / me / help appear in the merged set', () => {
    const client = getClientSlashCommands().map(c => c.name)
    const lib = getSlashCommands().map(c => c.name)
    const union = new Set([...client, ...lib])
    for (const must of ['shrug', 'tableflip', 'unflip', 'me', 'help']) {
      expect(union.has(must)).toBe(true)
    }
  })
})
