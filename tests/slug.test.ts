/**
 * AAELink — Slug Exhaustive Tests
 */
import { describe, it, expect } from 'vitest'
import { slugifySegment } from '@/lib/slug'

describe('Slug — basic transformation', () => {
  it('lowercases input', () => {
    expect(slugifySegment('Hello World')).toBe('hello-world')
  })
  it('replaces spaces with hyphens', () => {
    expect(slugifySegment('my channel name')).toBe('my-channel-name')
  })
  it('removes special characters', () => {
    expect(slugifySegment('test!@#$%^&*()')).toBe('test')
  })
  it('collapses multiple hyphens', () => {
    expect(slugifySegment('a---b')).toBe('a-b')
  })
  it('trims leading hyphens', () => {
    expect(slugifySegment('---leading')).toBe('leading')
  })
  it('trims trailing hyphens', () => {
    expect(slugifySegment('trailing---')).toBe('trailing')
  })
  it('preserves alphanumeric and hyphens', () => {
    expect(slugifySegment('test-123')).toBe('test-123')
  })
})

describe('Slug — max length', () => {
  it('truncates to 64 characters', () => {
    const long = 'a'.repeat(100)
    expect(slugifySegment(long).length).toBeLessThanOrEqual(64)
  })
  it('preserves full slug when < 64 chars', () => {
    expect(slugifySegment('short-slug')).toBe('short-slug')
  })
})

describe('Slug — fallback behavior', () => {
  it('uses fallback for single char result', () => {
    const result = slugifySegment('a')
    // 'a' is 1 char < 2, so uses fallback
    expect(result).toMatch(/^item-/)
  })
  it('uses fallback for empty input', () => {
    const result = slugifySegment('')
    expect(result).toMatch(/^item-/)
  })
  it('uses fallback for all-special-char input', () => {
    const result = slugifySegment('!@#$%')
    expect(result).toMatch(/^item-/)
  })
  it('uses custom fallback prefix', () => {
    const result = slugifySegment('', 'channel')
    expect(result).toMatch(/^channel-/)
  })
  it('uses custom fallback for single char', () => {
    const result = slugifySegment('x', 'workspace')
    expect(result).toMatch(/^workspace-/)
  })
  it('fallback slug is <= 22 chars', () => {
    const result = slugifySegment('', 'fallback')
    expect(result.length).toBeLessThanOrEqual(22)
  })
})

describe('Slug — preserves valid inputs', () => {
  it('preserves valid slug as-is', () => {
    expect(slugifySegment('already-valid')).toBe('already-valid')
  })
  it('preserves numeric slugs', () => {
    expect(slugifySegment('123')).toBe('123')
  })
  it('preserves two-char slug', () => {
    expect(slugifySegment('ab')).toBe('ab')
  })
})

describe('Slug — special character handling', () => {
  it('replaces underscores with hyphens', () => {
    expect(slugifySegment('a_b_c')).toBe('a-b-c')
  })
  it('replaces dots with hyphens', () => {
    expect(slugifySegment('v1.2.3')).toBe('v1-2-3')
  })
  it('handles mixed whitespace', () => {
    expect(slugifySegment('  hello   world  ')).toBe('hello-world')
  })
  it('handles unicode characters (removed)', () => {
    // Unicode chars are stripped, leaving just hyphens
    const result = slugifySegment('café')
    // 'caf' + e-accent stripped → 'caf' (3 chars >= 2)
    expect(result).toMatch(/^caf/)
  })
  it('handles tabs and newlines', () => {
    expect(slugifySegment('hello\tworld\nfoo')).toBe('hello-world-foo')
  })
})
