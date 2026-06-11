/**
 * AAELink — DLP content matching engine tests.
 *
 * Covers the pure matcher used by both the synchronous interceptor and the
 * dlp_scan background job: pattern/regex/keyword matching, channel scoping,
 * and highest-action selection.
 */
import { describe, it, expect } from 'vitest'
import { matchDlpRules, type DlpRule } from '@/lib/enterprise/dlpInterceptor'

function rule(over: Partial<DlpRule>): DlpRule {
  return {
    id: 'r1', name: 'rule', type: 'keyword', pattern: 'secret',
    action: 'warn', severity: 'medium', priority: 5,
    scope_channels: [], is_active: true, ...over,
  }
}

describe('DLP — matchDlpRules', () => {
  it('returns clean when no rule matches', () => {
    const res = matchDlpRules('nothing here', [rule({ pattern: 'classified' })])
    expect(res.clean).toBe(true)
    expect(res.violations).toHaveLength(0)
    expect(res.action).toBeNull()
  })

  it('matches keyword rules case-insensitively', () => {
    const res = matchDlpRules('This is SECRET stuff', [rule({ pattern: 'secret' })])
    expect(res.clean).toBe(false)
    expect(res.violations).toHaveLength(1)
  })

  it('matches regex rules (e.g. credit-card-like patterns)', () => {
    const ccRule = rule({ type: 'regex', pattern: '\\b\\d{4}-\\d{4}-\\d{4}-\\d{4}\\b', action: 'block' })
    const res = matchDlpRules('card 4111-1111-1111-1111 leaked', [ccRule])
    expect(res.clean).toBe(false)
    expect(res.action).toBe('block')
  })

  it('skips rules scoped to other channels', () => {
    const scoped = rule({ pattern: 'secret', scope_channels: ['c-finance'] })
    const res = matchDlpRules('secret data', [scoped], 'u1', 'c-eng')
    expect(res.clean).toBe(true)
  })

  it('applies rules scoped to the matching channel', () => {
    const scoped = rule({ pattern: 'secret', scope_channels: ['c-finance'] })
    const res = matchDlpRules('secret data', [scoped], 'u1', 'c-finance')
    expect(res.clean).toBe(false)
    expect(res.violations[0].channelId).toBe('c-finance')
  })

  it('selects the highest-priority action across multiple matches', () => {
    const res = matchDlpRules('secret password', [
      rule({ id: 'a', pattern: 'secret', action: 'warn' }),
      rule({ id: 'b', pattern: 'password', action: 'block' }),
    ])
    expect(res.violations).toHaveLength(2)
    expect(res.action).toBe('block')
  })

  it('truncates the recorded snippet to 200 chars', () => {
    const long = 'secret ' + 'x'.repeat(500)
    const res = matchDlpRules(long, [rule({ pattern: 'secret' })])
    expect(res.violations[0].snippet.length).toBe(200)
  })

  it('does not throw on an invalid regex pattern', () => {
    const bad = rule({ type: 'regex', pattern: '([unclosed' })
    expect(() => matchDlpRules('whatever', [bad])).not.toThrow()
  })
})
