/**
 * AAELink — Composer Markdown & Formatting Exhaustive Tests
 */
import { describe, it, expect } from 'vitest'
import { applyComposerFormat, applyComposerLink, type ComposerFormatKindNoLink } from '@/lib/composerMarkdown'

// ── Bold ────────────────────────────────────────────────────────────

describe('ComposerMarkdown — Bold', () => {
  it('wraps selection in **', () => {
    const r = applyComposerFormat('hello world', 6, 11, 'bold')!
    expect(r.text).toBe('hello **world**')
  })
  it('inserts placeholder when no selection', () => {
    const r = applyComposerFormat('hi ', 3, 3, 'bold')!
    expect(r.text).toBe('hi **bold**')
    expect(r.selectionStart).toBe(5)
    expect(r.selectionEnd).toBe(9)
  })
  it('selects the inner text (not the markers)', () => {
    const r = applyComposerFormat('abc', 0, 3, 'bold')!
    expect(r.selectionStart).toBe(2)
    expect(r.selectionEnd).toBe(5) // "abc" = 3 chars at offset 2
  })
  it('works at start of empty text', () => {
    const r = applyComposerFormat('', 0, 0, 'bold')!
    expect(r.text).toBe('**bold**')
  })
  it('preserves text before and after selection', () => {
    const r = applyComposerFormat('hello world foo', 6, 11, 'bold')!
    expect(r.text).toBe('hello **world** foo')
  })
})

// ── Italic ──────────────────────────────────────────────────────────

describe('ComposerMarkdown — Italic', () => {
  it('wraps selection in *', () => {
    const r = applyComposerFormat('test', 0, 4, 'italic')!
    expect(r.text).toBe('*test*')
  })
  it('inserts placeholder when no selection', () => {
    const r = applyComposerFormat('', 0, 0, 'italic')!
    expect(r.text).toBe('*italic*')
    expect(r.selectionStart).toBe(1)
    expect(r.selectionEnd).toBe(7) // "italic" = 6 chars
  })
  it('selects the inner text', () => {
    const r = applyComposerFormat('xyz', 0, 3, 'italic')!
    expect(r.selectionStart).toBe(1)
    expect(r.selectionEnd).toBe(4)
  })
})

// ── Code ────────────────────────────────────────────────────────────

describe('ComposerMarkdown — Code', () => {
  it('wraps in backticks', () => {
    const r = applyComposerFormat('foo', 0, 3, 'code')!
    expect(r.text).toBe('`foo`')
  })
  it('inserts placeholder when no selection', () => {
    const r = applyComposerFormat('', 0, 0, 'code')!
    expect(r.text).toBe('`code`')
    expect(r.selectionStart).toBe(1)
    expect(r.selectionEnd).toBe(5)
  })
  it('works mid-text', () => {
    const r = applyComposerFormat('use the function method', 8, 16, 'code')!
    expect(r.text).toBe('use the `function` method')
  })
})

// ── Ordered List ────────────────────────────────────────────────────

describe('ComposerMarkdown — Ordered List', () => {
  it('numbers single line', () => {
    const r = applyComposerFormat('item', 0, 4, 'olist')!
    expect(r.text).toBe('1. item')
  })
  it('numbers multiple lines', () => {
    const r = applyComposerFormat('a\nb\nc', 0, 5, 'olist')!
    expect(r.text).toBe('1. a\n2. b\n3. c')
  })
  it('inserts placeholder when no selection', () => {
    const r = applyComposerFormat('', 0, 0, 'olist')!
    expect(r.text).toBe('1. item')
  })
  it('cursor goes to end of list', () => {
    const r = applyComposerFormat('a\nb', 0, 3, 'olist')!
    expect(r.selectionStart).toBe(r.text.length)
    expect(r.selectionEnd).toBe(r.text.length)
  })
})

// ── Unordered List ──────────────────────────────────────────────────

describe('ComposerMarkdown — Unordered List', () => {
  it('bullets single line', () => {
    const r = applyComposerFormat('item', 0, 4, 'ulist')!
    expect(r.text).toBe('- item')
  })
  it('bullets multiple lines', () => {
    const r = applyComposerFormat('x\ny', 0, 3, 'ulist')!
    expect(r.text).toBe('- x\n- y')
  })
  it('inserts placeholder when no selection', () => {
    const r = applyComposerFormat('', 0, 0, 'ulist')!
    expect(r.text).toBe('- item')
  })
  it('cursor goes to end', () => {
    const r = applyComposerFormat('a', 0, 1, 'ulist')!
    expect(r.selectionStart).toBe(r.text.length)
  })
})

// ── Blockquote ──────────────────────────────────────────────────────

describe('ComposerMarkdown — Blockquote', () => {
  it('prepends > to each line', () => {
    const r = applyComposerFormat('line1\nline2', 0, 11, 'blockquote')!
    expect(r.text).toBe('> line1\n> line2')
  })
  it('inserts placeholder when no selection', () => {
    const r = applyComposerFormat('', 0, 0, 'blockquote')!
    expect(r.text).toBe('> quote')
  })
  it('handles single line', () => {
    const r = applyComposerFormat('test', 0, 4, 'blockquote')!
    expect(r.text).toBe('> test')
  })
  it('handles three lines', () => {
    const r = applyComposerFormat('a\nb\nc', 0, 5, 'blockquote')!
    expect(r.text).toBe('> a\n> b\n> c')
  })
})

// ── Link ────────────────────────────────────────────────────────────

describe('ComposerMarkdown — Link', () => {
  it('inserts markdown link with selection as label', () => {
    const r = applyComposerLink('click here', 0, 10, 'https://example.com')!
    expect(r.text).toBe('[click here](https://example.com)')
  })
  it('uses placeholder label when no selection', () => {
    const r = applyComposerLink('', 0, 0, 'https://x.com')!
    expect(r.text).toBe('[link text](https://x.com)')
  })
  it('returns null for empty URL', () => {
    expect(applyComposerLink('x', 0, 1, '')).toBeNull()
  })
  it('returns null for whitespace-only URL', () => {
    expect(applyComposerLink('x', 0, 1, '   ')).toBeNull()
  })
  it('trims URL whitespace', () => {
    const r = applyComposerLink('test', 0, 4, '  https://trimmed.com  ')!
    expect(r.text).toBe('[test](https://trimmed.com)')
  })
  it('cursor goes after the link', () => {
    const r = applyComposerLink('label', 0, 5, 'https://x.com')!
    expect(r.selectionStart).toBe(r.text.length)
    expect(r.selectionEnd).toBe(r.text.length)
  })
  it('works mid-text', () => {
    const r = applyComposerLink('see this for details', 4, 8, 'https://x.com')!
    expect(r.text).toBe('see [this](https://x.com) for details')
  })
})

// ── Edge Cases ──────────────────────────────────────────────────────

describe('ComposerMarkdown — Edge Cases', () => {
  it('clamps negative start to 0', () => {
    const r = applyComposerFormat('abc', -5, 3, 'bold')!
    expect(r.text).toBe('**abc**')
  })
  it('clamps end beyond text length', () => {
    const r = applyComposerFormat('abc', 0, 999, 'bold')!
    expect(r.text).toBe('**abc**')
  })
  it('swapped start/end uses max(start, 0)', () => {
    const r = applyComposerFormat('abc', 3, 0, 'bold')!
    // start > end → end is clamped to max(start, end)
    // The function does: start = Math.max(0, Math.min(selStart, text.length))
    //                     end = Math.max(start, Math.min(selEnd, text.length))
    // So start=3, end=max(3,0)=3 → empty selection
    expect(r.text).toContain('**bold**')
  })
})
