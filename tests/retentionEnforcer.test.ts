/**
 * AAELink — Retention enforcement legal-hold logic tests.
 *
 * The load-bearing rule: retention deletes must NEVER remove content protected
 * by an active legal hold. These tests cover the pure decision (isUnderHold)
 * and the SQL exclusion builder (buildHoldExclusion).
 */
import { describe, it, expect } from 'vitest'
import {
  cutoffForPolicy, isUnderHold, buildHoldExclusion, buildFileHoldExclusion,
  type ActiveHold,
} from '@/lib/enterprise/retentionEnforcer'

describe('Retention — cutoffForPolicy', () => {
  it('computes a cutoff N days in the past', () => {
    const now = 1_000_000_000_000
    const cutoff = cutoffForPolicy(30, now)
    expect(cutoff).toBe(now - 30 * 86400000)
  })
})

describe('Retention — isUnderHold', () => {
  const channelHold: ActiveHold = { channelIds: ['c1'], custodianIds: [], scopeFrom: 0, scopeTo: 0 }
  const allChannelHold: ActiveHold = { channelIds: [], custodianIds: [], scopeFrom: 0, scopeTo: 0 }
  const windowHold: ActiveHold = { channelIds: ['c2'], custodianIds: [], scopeFrom: 100, scopeTo: 200 }

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
    const h: ActiveHold = { channelIds: ['c3'], custodianIds: [], scopeFrom: 100, scopeTo: 0 }
    expect(isUnderHold([h], 'c3', 999_999)).toBe(true)
    expect(isUnderHold([h], 'c3', 50)).toBe(false)
  })

  it('no holds means nothing is protected', () => {
    expect(isUnderHold([], 'c1', 5)).toBe(false)
  })

  it('custodian-only hold protects content owned by a listed custodian', () => {
    const h: ActiveHold = { channelIds: [], custodianIds: ['u1'], scopeFrom: 0, scopeTo: 0 }
    // matches by custodian regardless of channel
    expect(isUnderHold([h], 'anychannel', 5, 'u1')).toBe(true)
    // a different custodian (or none) is NOT protected by this hold
    expect(isUnderHold([h], 'anychannel', 5, 'u2')).toBe(false)
    expect(isUnderHold([h], 'anychannel', 5)).toBe(false)
  })

  it('channel-scoped hold conservatively protects a NULL-channel (unattached) file', () => {
    // An unattached file (channel unknown) cannot be proven outside a channel
    // hold → it is protected.
    expect(isUnderHold([channelHold], null, 5, 'u9')).toBe(true)
    expect(isUnderHold([channelHold], '', 5, 'u9')).toBe(true)
  })

  it('a custodian-only hold does NOT protect a NULL-channel file owned by another user', () => {
    const h: ActiveHold = { channelIds: [], custodianIds: ['u1'], scopeFrom: 0, scopeTo: 0 }
    expect(isUnderHold([h], null, 5, 'u2')).toBe(false)
  })
})

describe('Retention — buildHoldExclusion', () => {
  it('returns empty clause when there are no holds', () => {
    const ex = buildHoldExclusion([], 'm.channel_id', 'm.created_at', 2)
    expect(ex.clause).toBe('')
    expect(ex.params).toEqual([])
  })

  it('builds a NOT(...) exclusion for a channel + open window hold', () => {
    const holds: ActiveHold[] = [{ channelIds: ['c1'], custodianIds: [], scopeFrom: 0, scopeTo: 0 }]
    const ex = buildHoldExclusion(holds, 'm.channel_id', 'm.created_at', 2)
    expect(ex.clause).toContain('AND NOT')
    expect(ex.clause).toContain('m.channel_id = ANY($2::text[])')
    expect(ex.clause).toContain('m.created_at >= $3')
    expect(ex.params).toEqual([['c1'], 0])
  })

  it('includes an upper bound when scopeTo > 0', () => {
    const holds: ActiveHold[] = [{ channelIds: ['c2'], custodianIds: [], scopeFrom: 100, scopeTo: 200 }]
    const ex = buildHoldExclusion(holds, 'm.channel_id', 'm.created_at', 2)
    expect(ex.clause).toContain('m.created_at <= $4')
    expect(ex.params).toEqual([['c2'], 100, 200])
  })

  it('omits channel predicate for an all-channel hold', () => {
    const holds: ActiveHold[] = [{ channelIds: [], custodianIds: [], scopeFrom: 0, scopeTo: 0 }]
    const ex = buildHoldExclusion(holds, 'm.channel_id', 'm.created_at', 2)
    expect(ex.clause).not.toContain('ANY')
    expect(ex.clause).toContain('m.created_at >= $2')
    expect(ex.params).toEqual([0])
  })

  it('chains multiple holds with OR (any hold protects)', () => {
    const holds: ActiveHold[] = [
      { channelIds: ['c1'], custodianIds: [], scopeFrom: 0, scopeTo: 0 },
      { channelIds: ['c2'], custodianIds: [], scopeFrom: 0, scopeTo: 0 },
    ]
    const ex = buildHoldExclusion(holds, 'm.channel_id', 'm.created_at', 2)
    expect(ex.clause).toContain(' OR ')
    // second hold params start after the first hold consumed $2,$3
    expect(ex.clause).toContain('$4::text[]')
  })

  it('adds a custodian predicate (channel OR custodian) when custodianCol is given', () => {
    const holds: ActiveHold[] = [{ channelIds: ['c1'], custodianIds: ['u1'], scopeFrom: 0, scopeTo: 0 }]
    const ex = buildHoldExclusion(holds, 'm.channel_id', 'm.created_at', 2, 'm.user_id')
    // channel ($2) OR custodian ($3) protect, time predicate ($4)
    expect(ex.clause).toContain('m.channel_id = ANY($2::text[])')
    expect(ex.clause).toContain('m.user_id = ANY($3::text[])')
    expect(ex.clause).toContain(' OR ')
    expect(ex.clause).toContain('m.created_at >= $4')
    expect(ex.params).toEqual([['c1'], ['u1'], 0])
  })

  it('honors a custodian-only hold (no channel scope) when custodianCol is given', () => {
    const holds: ActiveHold[] = [{ channelIds: [], custodianIds: ['u7'], scopeFrom: 0, scopeTo: 0 }]
    const ex = buildHoldExclusion(holds, 'm.channel_id', 'm.created_at', 2, 'm.user_id')
    expect(ex.clause).toContain('m.user_id = ANY($2::text[])')
    expect(ex.clause).not.toContain('m.channel_id')
    expect(ex.clause).toContain('m.created_at >= $3')
    expect(ex.params).toEqual([['u7'], 0])
  })

  it('ignores custodian dimension when custodianCol is omitted (message back-compat)', () => {
    const holds: ActiveHold[] = [{ channelIds: ['c1'], custodianIds: ['u1'], scopeFrom: 0, scopeTo: 0 }]
    const ex = buildHoldExclusion(holds, 'm.channel_id', 'm.created_at', 2)
    expect(ex.clause).not.toContain('user_id')
    expect(ex.params).toEqual([['c1'], 0])
  })
})

describe('Retention — buildFileHoldExclusion', () => {
  it('protects NULL-channel files when a channel-scoped hold is active', () => {
    const holds: ActiveHold[] = [{ channelIds: ['c1'], custodianIds: [], scopeFrom: 0, scopeTo: 0 }]
    const ex = buildFileHoldExclusion(holds, 'channel_id', 'created_at', 'user_id', 3)
    // Standard channel/time protection plus the NULL-channel safety branch.
    expect(ex.clause).toContain('channel_id = ANY($3::text[])')
    expect(ex.clause).toContain('created_at >= $4')
    expect(ex.clause).toContain('channel_id IS NULL')
    // The null guard is ORed into the protected set (inside the NOT(...)).
    expect(ex.clause).toMatch(/OR channel_id IS NULL\)$/)
    // No extra params consumed by the null guard.
    expect(ex.params).toEqual([['c1'], 0])
  })

  it('does NOT add the NULL-channel guard when no hold is channel-scoped', () => {
    const holds: ActiveHold[] = [{ channelIds: [], custodianIds: ['u1'], scopeFrom: 0, scopeTo: 0 }]
    const ex = buildFileHoldExclusion(holds, 'channel_id', 'created_at', 'user_id', 3)
    // custodian-only hold → protect by custodian/time only, no null guard.
    expect(ex.clause).toContain('user_id = ANY($3::text[])')
    expect(ex.clause).not.toContain('channel_id IS NULL')
    expect(ex.params).toEqual([['u1'], 0])
  })

  it('returns an empty clause when there are no holds', () => {
    const ex = buildFileHoldExclusion([], 'channel_id', 'created_at', 'user_id', 3)
    expect(ex.clause).toBe('')
    expect(ex.params).toEqual([])
  })

  it('protects custodian-owned files AND NULL-channel files for a mixed hold', () => {
    const holds: ActiveHold[] = [{ channelIds: ['c1'], custodianIds: ['u1'], scopeFrom: 0, scopeTo: 0 }]
    const ex = buildFileHoldExclusion(holds, 'channel_id', 'created_at', 'user_id', 3)
    expect(ex.clause).toContain('channel_id = ANY($3::text[])')
    expect(ex.clause).toContain('user_id = ANY($4::text[])')
    expect(ex.clause).toContain('created_at >= $5')
    expect(ex.clause).toContain('channel_id IS NULL')
    expect(ex.params).toEqual([['c1'], ['u1'], 0])
  })
})
