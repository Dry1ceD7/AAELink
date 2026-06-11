/**
 * AAELink — `<SearchFilters>` chip primitive helpers
 *
 * The visual `<SearchFilters>` component itself is a thin chip renderer.
 * The interesting logic lives in two pure helpers it depends on:
 *   • `removeFilterToken(raw, key)`   — strips a single `key:value` token
 *                                       from a raw query string
 *   • `formatFilterChip(key, value)`   — produces the chip label text
 *
 * Both are exported from `lib/searchFilters.ts` so the chip component
 * can stay declarative and dependency-free.
 */
import { describe, it, expect } from 'vitest'
import { removeFilterToken, formatFilterChip } from '@/lib/messaging/searchFilters'

describe('removeFilterToken — strips a single key:value', () => {
  it('strips from:alice and trims trailing whitespace', () => {
    expect(removeFilterToken('deploy from:alice', 'from')).toBe('deploy')
  })

  it('strips a leading filter and trims leading whitespace', () => {
    expect(removeFilterToken('from:bob standup', 'from')).toBe('standup')
  })

  it('strips a middle filter and collapses whitespace', () => {
    expect(removeFilterToken('release has:link notes', 'has')).toBe('release notes')
  })

  it('only strips the matching key, leaving others intact', () => {
    expect(removeFilterToken('deploy from:alice has:link', 'from')).toBe('deploy has:link')
  })

  it('returns the original query if the key is not present', () => {
    expect(removeFilterToken('deploy from:alice', 'has')).toBe('deploy from:alice')
  })

  it('handles case-insensitive key matches', () => {
    expect(removeFilterToken('FROM:alice deploy', 'from')).toBe('deploy')
  })

  it('drops only the first occurrence and leaves any trailing one', () => {
    expect(removeFilterToken('from:alice deploy from:bob', 'from')).toBe('deploy from:bob')
  })

  it('handles a query that is only the filter token', () => {
    expect(removeFilterToken('from:alice', 'from')).toBe('')
  })
})

describe('formatFilterChip — chip label text', () => {
  it('formats from:<user> as "from: alice"', () => {
    expect(formatFilterChip('from', 'alice')).toBe('from: alice')
  })

  it('formats in:<channel> as "in: general"', () => {
    expect(formatFilterChip('in', 'general')).toBe('in: general')
  })

  it('formats before:<date> as "before 2025-01-01"', () => {
    expect(formatFilterChip('before', '2025-01-01')).toBe('before 2025-01-01')
  })

  it('formats after:<date> as "after 2025-01-01"', () => {
    expect(formatFilterChip('after', '2025-01-01')).toBe('after 2025-01-01')
  })

  it('formats has:<keyword> as "has: link"', () => {
    expect(formatFilterChip('has', 'link')).toBe('has: link')
  })
})
