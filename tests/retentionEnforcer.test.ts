/**
 * AAELink — Retention enforcement legal-hold logic tests.
 *
 * The load-bearing rule: retention deletes must NEVER remove content protected
 * by an active legal hold. These tests cover the pure decision (isUnderHold)
 * and the SQL exclusion builder (buildHoldExclusion).
 */
import { describe, it, expect } from 'vitest'
import {
  cutoffForPolicy, isUnderHold, buildHoldExclusion, type ActiveHold,
} from '@/lib/enterprise/retentionEnforcer'

describe('Retention — cutoffForPolicy', () => {
  it('computes a cutoff N days in the past', () => {
    const now = 1_000_000_000_000
    const cutoff = cutoffForPolicy(30, now)
    expect(cutoff).toBe(now - 30 * 86400000)
  })
})

describe('Retention — isUnderHold', () => {
  const channelHold: ActiveHold = { channelIds: ['c1'], scopeFrom: 0, scopeTo: 0 }
  const allChannelHold: ActiveHold = { channelIds: [], scopeFrom: 0, scopeTo: 0 }
  const windowHold: ActiveHold = { channelIds: ['c2'], scopeFrom: 100, scopeTo: 200 }

  it('protects content in a held channel', () => {
    expect(isUnderHold([channelHold], 'c1', 5)).toBe(true)
  })

  it('does not protect content in a non-held channel', () => {
    expect(isUnderHold([channelHold], 'c9', 5)).toBe(false)
  })

  it('all-channel hold (empty channelIds) protects every channel', () => {
    expect(isUnderHold([allChannelHold], 'anything', 5)).toBe(true)
  })

  it('respects a time window', () => {
    expect(isUnderHold([windowHold], 'c2', 150)).toBe(true)
    expect(isUnderHold([windowHold], 'c2', 50)).toBe(false)  // before window
    expect(isUnderHold([windowHold], 'c2', 250)).toBe(false) // after window
  })

  it('scopeTo=0 means open-ended (forever forward)', () => {
    const h: ActiveHold = { channelIds: ['c3'], scopeFrom: 100, scopeTo: 0 }
    expect(isUnderHold([h], 'c3', 999_999)).toBe(true)
    expect(isUnderHold([h], 'c3', 50)).toBe(false)
  })

  it('no holds means nothing is protected', () => {
    expect(isUnderHold([], 'c1', 5)).toBe(false)
  })
})

describe('Retention — buildHoldExclusion', () => {
  it('returns empty clause when there are no holds', () => {
    const ex = buildHoldExclusion([], 'm.channel_id', 'm.created_at', 2)
    expect(ex.clause).toBe('')
    expect(ex.params).toEqual([])
  })

  it('builds a NOT(...) exclusion for a channel + open window hold', () => {
    const holds: ActiveHold[] = [{ channelIds: ['c1'], scopeFrom: 0, scopeTo: 0 }]
    const ex = buildHoldExclusion(holds, 'm.channel_id', 'm.created_at', 2)
    expect(ex.clause).toContain('AND NOT')
    expect(ex.clause).toContain('m.channel_id = ANY($2::text[])')
    expect(ex.clause).toContain('m.created_at >= $3')
    expect(ex.params).toEqual([['c1'], 0])
  })

  it('includes an upper bound when scopeTo > 0', () => {
    const holds: ActiveHold[] = [{ channelIds: ['c2'], scopeFrom: 100, scopeTo: 200 }]
    const ex = buildHoldExclusion(holds, 'm.channel_id', 'm.created_at', 2)
    expect(ex.clause).toContain('m.created_at <= $4')
    expect(ex.params).toEqual([['c2'], 100, 200])
  })

  it('omits channel predicate for an all-channel hold', () => {
    const holds: ActiveHold[] = [{ channelIds: [], scopeFrom: 0, scopeTo: 0 }]
    const ex = buildHoldExclusion(holds, 'm.channel_id', 'm.created_at', 2)
    expect(ex.clause).not.toContain('ANY')
    expect(ex.clause).toContain('m.created_at >= $2')
    expect(ex.params).toEqual([0])
  })

  it('chains multiple holds with OR (any hold protects)', () => {
    const holds: ActiveHold[] = [
      { channelIds: ['c1'], scopeFrom: 0, scopeTo: 0 },
      { channelIds: ['c2'], scopeFrom: 0, scopeTo: 0 },
    ]
    const ex = buildHoldExclusion(holds, 'm.channel_id', 'm.created_at', 2)
    expect(ex.clause).toContain(' OR ')
    // second hold params start after the first hold consumed $2,$3
    expect(ex.clause).toContain('$4::text[]')
  })
})
