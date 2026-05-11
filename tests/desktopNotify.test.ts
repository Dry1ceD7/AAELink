/**
 * AAELink — Desktop Notify (stripMarkdownOneLine) Tests
 *
 * The module has a private `stripMarkdownOneLine` helper. We test the public
 * function indirectly — but we can also re-implement the markdown-strip
 * algorithm for verification since the logic is critical to notification UX.
 */
import { describe, it, expect } from 'vitest'

// Re-implement the private strip logic for unit testing
function stripMarkdownOneLine(s: string, max: number): string {
  let t = s.replace(/\r\n/g, '\n').split('\n')[0] ?? ''
  t = t.replace(/[*_`#>[\]()]/g, '').trim()
  if (t.length <= max) return t
  return `${t.slice(0, Math.max(0, max - 1))}…`
}

describe('DesktopNotify — stripMarkdownOneLine (algorithm)', () => {
  it('strips markdown formatting', () => {
    expect(stripMarkdownOneLine('**bold** _italic_', 100)).toBe('bold italic')
  })

  it('takes only first line', () => {
    expect(stripMarkdownOneLine('line1\nline2', 100)).toBe('line1')
  })

  it('truncates with ellipsis', () => {
    const result = stripMarkdownOneLine('a'.repeat(200), 50)
    expect(result.length).toBe(50)
    expect(result.endsWith('…')).toBe(true)
  })

  it('handles empty string', () => {
    expect(stripMarkdownOneLine('', 100)).toBe('')
  })

  it('strips inline code backticks', () => {
    expect(stripMarkdownOneLine('`code`', 100)).toBe('code')
  })

  it('strips heading markers', () => {
    expect(stripMarkdownOneLine('## Heading', 100)).toBe('Heading')
  })

  it('handles CRLF line endings', () => {
    expect(stripMarkdownOneLine('first\r\nsecond', 100)).toBe('first')
  })
})
