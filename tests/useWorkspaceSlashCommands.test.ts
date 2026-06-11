/**
 * `lib/useWorkspaceSlashCommands.ts` regression suite.
 *
 * Focuses on the pure `selectCustomCommands` mapper, which is the only piece
 * with non-trivial logic. The hook itself is a thin React wrapper around a
 * cached `apiFetch` call; the cache reset helper is exposed so the build
 * remains tree-shake friendly without hidden state leaks across tests.
 */
import { describe, it, expect } from 'vitest'
import {
  selectCustomCommands,
  _resetWorkspaceSlashCommandsCache,
} from '@/lib/ui/useWorkspaceSlashCommands'

describe('useWorkspaceSlashCommands — selectCustomCommands', () => {
  it('returns an empty array for null input', () => {
    expect(selectCustomCommands(null)).toEqual([])
  })

  it('returns an empty array for missing commands field', () => {
    expect(selectCustomCommands({})).toEqual([])
  })

  it('returns an empty array when commands is not an array', () => {
    // Cast through unknown to satisfy TypeScript while still exercising the
    // runtime defensiveness — the API is allowed to return malformed JSON.
    expect(selectCustomCommands({ commands: 'oops' as unknown as never })).toEqual([])
  })

  it('drops built-ins (is_builtin === true)', () => {
    const result = selectCustomCommands({
      commands: [
        { name: 'shrug', description: 'Built-in', usage: '/shrug', is_builtin: true },
        { name: 'deploy', description: 'Custom', usage: '/deploy [env]', is_builtin: false },
      ],
    })
    expect(result.map(c => c.name)).toEqual(['deploy'])
  })

  it('keeps custom commands even when `is_builtin` is unset (defaults to non-builtin)', () => {
    const result = selectCustomCommands({
      commands: [{ name: 'deploy', description: 'Custom', usage: '/deploy' }],
    })
    expect(result).toEqual([{ name: 'deploy', description: 'Custom', usage: '/deploy' }])
  })

  it('drops entries with no name', () => {
    const result = selectCustomCommands({
      commands: [
        { description: 'no name', usage: '/x' },
        { name: '', description: 'empty name', usage: '/' },
        { name: 'real', description: 'real', usage: '/real' },
      ],
    })
    expect(result.map(c => c.name)).toEqual(['real'])
  })

  it('synthesizes a usage string when missing', () => {
    const result = selectCustomCommands({
      commands: [{ name: 'foo', description: 'Foo' }],
    })
    expect(result[0].usage).toBe('/foo')
  })

  it('synthesizes a description when missing', () => {
    const result = selectCustomCommands({
      commands: [{ name: 'foo' }],
    })
    expect(result[0].description).toBe('Custom command /foo')
  })
})

describe('useWorkspaceSlashCommands — cache helper', () => {
  it('cache reset is a no-op outside of test mode (does not throw)', () => {
    expect(() => _resetWorkspaceSlashCommandsCache()).not.toThrow()
  })
})
