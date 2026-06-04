/**
 * AAELink — `lib/searchFilters.ts` parser tests
 *
 * The parser turns a free-form search query like
 *   "deploy from:alice has:link before:2025-01-01"
 * into a structured `SearchFilters` object.
 */
import { describe, it, expect } from 'vitest'
import {
  parseSearchFilters,
  validateHasValue,
  isValidDate,
  type SearchFilters,
} from '@/lib/messaging/searchFilters'

describe('parseSearchFilters — basic text-only', () => {
  it('returns empty text and no filters for an empty string', () => {
    expect(parseSearchFilters('')).toEqual({ text: '' } satisfies SearchFilters)
  })

  it('preserves a plain query as text with no filters', () => {
    expect(parseSearchFilters('how do i deploy')).toEqual({
      text: 'how do i deploy',
    } satisfies SearchFilters)
  })

  it('trims and collapses whitespace', () => {
    expect(parseSearchFilters('  hello   world  ')).toEqual({
      text: 'hello world',
    } satisfies SearchFilters)
  })
})

describe('parseSearchFilters — single filter extraction', () => {
  it('extracts from:<user>', () => {
    expect(parseSearchFilters('deploy from:alice')).toEqual({
      text: 'deploy',
      from: 'alice',
    } satisfies SearchFilters)
  })

  it('extracts in:<channel>', () => {
    expect(parseSearchFilters('in:general standup')).toEqual({
      text: 'standup',
      in: 'general',
    } satisfies SearchFilters)
  })

  it('extracts has:link', () => {
    expect(parseSearchFilters('release notes has:link')).toEqual({
      text: 'release notes',
      has: 'link',
    } satisfies SearchFilters)
  })

  it('extracts before:<date>', () => {
    expect(parseSearchFilters('before:2025-01-01 retro')).toEqual({
      text: 'retro',
      before: '2025-01-01',
    } satisfies SearchFilters)
  })

  it('extracts after:<date>', () => {
    expect(parseSearchFilters('after:2025-06-15 summary')).toEqual({
      text: 'summary',
      after: '2025-06-15',
    } satisfies SearchFilters)
  })

  it('extracts on:<date>', () => {
    expect(parseSearchFilters('on:2025-03-04 incident')).toEqual({
      text: 'incident',
      on: '2025-03-04',
    } satisfies SearchFilters)
  })

  it('extracts during:<year>', () => {
    expect(parseSearchFilters('during:2025 launch')).toEqual({
      text: 'launch',
      during: '2025',
    } satisfies SearchFilters)
  })

  it('extracts during:<year-month>', () => {
    expect(parseSearchFilters('retro during:2025-06')).toEqual({
      text: 'retro',
      during: '2025-06',
    } satisfies SearchFilters)
  })
})

describe('parseSearchFilters — is: flags (multi-valued)', () => {
  it('extracts a single is:thread flag', () => {
    expect(parseSearchFilters('deploy is:thread')).toEqual({
      text: 'deploy',
      is: ['thread'],
    } satisfies SearchFilters)
  })

  it('collects multiple is: flags in first-seen order, deduped', () => {
    expect(parseSearchFilters('is:thread notes is:pinned is:thread')).toEqual({
      text: 'notes',
      is: ['thread', 'pinned'],
    } satisfies SearchFilters)
  })

  it('supports is:saved', () => {
    expect(parseSearchFilters('summary is:saved')).toEqual({
      text: 'summary',
      is: ['saved'],
    } satisfies SearchFilters)
  })

  it('leaves an unknown is:<flag> in the free text', () => {
    const r = parseSearchFilters('plan is:dm')
    expect(r.is).toBeUndefined()
    expect(r.text).toContain('is:dm')
  })

  it('combines is: flags with single-value filters', () => {
    expect(parseSearchFilters('from:alice deploy is:thread has:link')).toEqual({
      text: 'deploy',
      from: 'alice',
      has: 'link',
      is: ['thread'],
    } satisfies SearchFilters)
  })
})

describe('parseSearchFilters — multi-filter combinations', () => {
  it('handles three filters plus free text', () => {
    expect(parseSearchFilters('deploy from:alice has:link before:2025-01-01')).toEqual({
      text: 'deploy',
      from: 'alice',
      has: 'link',
      before: '2025-01-01',
    } satisfies SearchFilters)
  })

  it('extracts filters regardless of position', () => {
    expect(parseSearchFilters('from:bob standup in:engineering after:2025-01-01')).toEqual({
      text: 'standup',
      from: 'bob',
      in: 'engineering',
      after: '2025-01-01',
    } satisfies SearchFilters)
  })

  it('keys are case-insensitive (FROM:Alice → from)', () => {
    expect(parseSearchFilters('FROM:alice deploy')).toEqual({
      text: 'deploy',
      from: 'alice',
    } satisfies SearchFilters)
  })
})

describe('parseSearchFilters — invalid input handling', () => {
  it('drops malformed filters (from: with no value)', () => {
    // The regex `\b(from|in|before|after|has):(\S+)` requires a non-empty value
    // following the colon, so "from: " has no match and the colon stays in text.
    const result = parseSearchFilters('from: deploy')
    expect(result.from).toBeUndefined()
    expect(result.text).toContain('deploy')
  })

  it('keeps unknown prefix (foo:bar) inside text', () => {
    expect(parseSearchFilters('foo:bar baz')).toEqual({
      text: 'foo:bar baz',
    } satisfies SearchFilters)
  })

  it('handles only a filter with no text', () => {
    expect(parseSearchFilters('from:alice')).toEqual({
      text: '',
      from: 'alice',
    } satisfies SearchFilters)
  })
})

describe('isValidDate', () => {
  it('accepts YYYY-MM-DD', () => {
    expect(isValidDate('2025-01-01')).toBe(true)
    expect(isValidDate('2026-12-31')).toBe(true)
  })

  it('rejects malformed strings', () => {
    expect(isValidDate('2025-1-1')).toBe(false)
    expect(isValidDate('01-01-2025')).toBe(false)
    expect(isValidDate('not-a-date')).toBe(false)
    expect(isValidDate('')).toBe(false)
  })
})

describe('validateHasValue', () => {
  it('accepts the supported keywords', () => {
    expect(validateHasValue('link')).toBe(true)
    expect(validateHasValue('file')).toBe(true)
    expect(validateHasValue('attachment')).toBe(true)
    expect(validateHasValue('pin')).toBe(true)
    expect(validateHasValue('reaction')).toBe(true)
  })

  it('rejects unsupported keywords', () => {
    expect(validateHasValue('image')).toBe(false)
    expect(validateHasValue('LINK')).toBe(false) // case-sensitive matches the API
    expect(validateHasValue('')).toBe(false)
  })
})
