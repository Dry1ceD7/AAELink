/**
 * batchFindReplace — small standalone module split out of `lib/templateEngine.ts`
 * so the document find-and-replace route does not depend on the heavyweight
 * Mustache template engine.  These tests preserve the behavior of the original
 * `batchFindReplace` export from the engine.
 */
import { describe, it, expect } from 'vitest'
import { batchFindReplace, type FindReplaceRule } from '@/lib/messaging/findReplace'

describe('findReplace — batchFindReplace', () => {
  it('replaces simple text', () => {
    expect(batchFindReplace('hello world', [{ find: 'world', replace: 'earth' }])).toBe('hello earth')
  })

  it('is case insensitive by default', () => {
    expect(batchFindReplace('Hello HELLO hello', [{ find: 'hello', replace: 'hi' }])).toBe('hi hi hi')
  })

  it('honors case_sensitive flag', () => {
    expect(
      batchFindReplace('Hello HELLO hello', [{ find: 'Hello', replace: 'hi', case_sensitive: true }])
    ).toBe('hi HELLO hello')
  })

  it('honors whole_word flag', () => {
    expect(batchFindReplace('cat category', [{ find: 'cat', replace: 'dog', whole_word: true }])).toBe(
      'dog category'
    )
  })

  it('applies multiple rules in order', () => {
    const rules: FindReplaceRule[] = [
      { find: 'a', replace: 'x' },
      { find: 'b', replace: 'y' },
      { find: 'c', replace: 'z' },
    ]
    expect(batchFindReplace('a b c', rules)).toBe('x y z')
  })

  it('skips rules with an empty find string', () => {
    expect(batchFindReplace('hello', [{ find: '', replace: 'x' }])).toBe('hello')
  })

  it('escapes regex metacharacters in the find string', () => {
    expect(
      batchFindReplace('price: $100.00', [{ find: '$100.00', replace: '$200.00' }])
    ).toBe('price: $200.00')
  })

  it('returns the input unchanged when no rules match', () => {
    expect(batchFindReplace('hello', [{ find: 'world', replace: 'earth' }])).toBe('hello')
  })

  it('returns the input unchanged when given no rules', () => {
    expect(batchFindReplace('hello', [])).toBe('hello')
  })

  it('treats the find string literally — not as a regex', () => {
    // ".*" should match the literal substring, not "any character zero or more times".
    expect(batchFindReplace('a.*b ab', [{ find: '.*', replace: 'X' }])).toBe('aXb ab')
  })
})
