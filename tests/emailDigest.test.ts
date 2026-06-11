/**
 * Unit tests for email-digest compose/scheduling (pure, no DB).
 *
 * DB-backed collection + watermark advance lives in
 * __tests__/api/email-digest.test.ts.
 */
import { describe, it, expect } from 'vitest'
import {
  composeDigest,
  isDigestDue,
  digestIntervalMs,
  type DigestItem,
} from '@/lib/notifications/emailDigest'

const items: DigestItem[] = [
  { id: 'n1', kind: 'mention', title: 'Mention in #general', body: 'alice: hey @you', created_at: 100 },
  { id: 'n2', kind: 'mention', title: 'Mention in #random', body: 'bob: @you look', created_at: 200 },
  { id: 'n3', kind: 'dm', title: 'carol', body: 'are you free?', created_at: 300 },
  { id: 'n4', kind: 'keyword', title: 'Keyword in #ops', body: 'dan: deploy failed', created_at: 400 },
]

describe('isDigestDue', () => {
  it('off is never due', () => {
    expect(isDigestDue('off', 0, 1e15)).toBe(false)
  })
  it('daily is due after 24h, not before', () => {
    const now = 10 * 86_400_000
    expect(isDigestDue('daily', now - 86_400_000, now)).toBe(true)
    expect(isDigestDue('daily', now - 86_399_000, now)).toBe(false)
  })
  it('weekly is due after 7d', () => {
    const now = 30 * 86_400_000
    expect(isDigestDue('weekly', now - 7 * 86_400_000, now)).toBe(true)
    expect(isDigestDue('weekly', now - 6 * 86_400_000, now)).toBe(false)
  })
  it('hourly is due after 1h, not before', () => {
    const now = 100 * 3_600_000
    expect(isDigestDue('hourly', now - 3_600_000, now)).toBe(true)
    expect(isDigestDue('hourly', now - 3_599_000, now)).toBe(false)
  })
  it('intervals are correct', () => {
    expect(digestIntervalMs('hourly')).toBe(3_600_000)
    expect(digestIntervalMs('daily')).toBe(86_400_000)
    expect(digestIntervalMs('weekly')).toBe(7 * 86_400_000)
    expect(digestIntervalMs('off')).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('composeDigest', () => {
  it('returns null when there is nothing to send', () => {
    expect(composeDigest('daily', [])).toBeNull()
  })

  it('groups items by kind and counts them', () => {
    const out = composeDigest('daily', items)!
    expect(out.subject).toContain('daily')
    expect(out.subject).toContain('4 new items')
    // Plain text contains a group header per kind and a bullet per item.
    expect(out.text).toContain('Mentions (2):')
    expect(out.text).toContain('Direct messages (1):')
    expect(out.text).toContain('Keyword highlights (1):')
    expect(out.text).toContain('• Mention in #general: alice: hey @you')
    expect(out.text).toContain('• carol: are you free?')
  })

  it('uses singular wording for one item and a weekly subject', () => {
    const out = composeDigest('weekly', [items[0]])!
    expect(out.subject).toContain('weekly')
    expect(out.subject).toContain('1 new item')
    expect(out.subject).not.toContain('1 new items')
  })

  it('uses an hourly period label in the subject', () => {
    const out = composeDigest('hourly', items)!
    expect(out.subject).toContain('hourly')
    expect(out.subject).toContain('4 new items')
  })

  it('escapes HTML in item content', () => {
    const out = composeDigest('daily', [
      { id: 'n5', kind: 'dm', title: 'eve', body: '<script>x</script> & "quotes"', created_at: 1 },
    ])!
    expect(out.html).toContain('&lt;script&gt;')
    expect(out.html).toContain('&amp;')
    expect(out.html).not.toContain('<script>x</script>')
  })
})
