/**
 * AAELink — Admin push-policy enforcement tests (pushPolicy.ts + its wiring
 * into selectPushTargets). No live DB: the pg pool is injected.
 *
 * Covers:
 *   - org quiet hours drops targets TZ-correctly (inside the window),
 *   - passes outside the window,
 *   - max_rate caps the Nth push per user,
 *   - absent / disabled policy is a no-op.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Pool } from 'pg'
import {
  getPushPolicy, applyQuietHours, applyMaxRate, type PushPolicy,
} from '@/lib/notifications/pushPolicy'
import { selectPushTargets } from '@/lib/notifications/pushTargeting'
import { __resetRateLimitForTests } from '@/lib/api/rateLimitStore'

/**
 * Fake pool handling the four queries selectPushTargets may issue: the
 * push_policy system_config read, channel mutes, dnd_settings, user_status.
 * `policyJson` (when set) is returned as the system_config value.
 */
function fakePool(opts: { policyJson?: string | null } = {}): Pool {
  return {
    query: vi.fn(async (sql: string) => {
      if (/system_config/.test(sql)) {
        return opts.policyJson != null
          ? { rows: [{ value: opts.policyJson }] }
          : { rows: [] }
      }
      if (/channel_notification_prefs/.test(sql)) return { rows: [] }
      if (/dnd_settings/.test(sql)) return { rows: [] }
      if (/user_status/.test(sql)) return { rows: [] }
      return { rows: [] }
    }),
  } as unknown as Pool
}

const policy = (over: Partial<PushPolicy> = {}): PushPolicy => ({
  enabled: true,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  quiet_hours_timezone: 'UTC',
  max_rate_per_user_per_hour: 0,
  ...over,
})

beforeEach(() => {
  delete process.env.REDIS_URL // force in-process counter
  __resetRateLimitForTests()
})

describe('getPushPolicy', () => {
  it('returns null when no policy row exists (absent → no-op)', async () => {
    expect(await getPushPolicy(fakePool())).toBeNull()
  })

  it('returns null when stored JSON is unparseable', async () => {
    expect(await getPushPolicy(fakePool({ policyJson: '{bad' }))).toBeNull()
  })

  it('merges stored fields over defaults', async () => {
    const p = await getPushPolicy(fakePool({
      policyJson: JSON.stringify({ max_rate_per_user_per_hour: 5, quiet_hours_timezone: 'Asia/Bangkok' }),
    }))
    expect(p).toMatchObject({
      enabled: true,
      max_rate_per_user_per_hour: 5,
      quiet_hours_timezone: 'Asia/Bangkok',
    })
  })
})

describe('applyQuietHours — TZ-aware', () => {
  // 2026-01-15T23:30:00Z is inside 22:00-07:00 UTC; 12:00Z is outside.
  const inside = new Date('2026-01-15T23:30:00.000Z')
  const outside = new Date('2026-01-15T12:00:00.000Z')

  it('drops all targets inside the org quiet-hours window', () => {
    expect(applyQuietHours(policy(), ['u1', 'u2'], inside)).toEqual([])
  })

  it('passes all targets outside the window', () => {
    expect(applyQuietHours(policy(), ['u1', 'u2'], outside)).toEqual(['u1', 'u2'])
  })

  it('honors the policy timezone (TZ-correct) for the 22:00-07:00 window', () => {
    // Asia/Bangkok is +07, so the same UTC instant maps to a different local
    // wall-clock time than UTC — proving the window is evaluated in the policy TZ.
    const bkk = policy({ quiet_hours_timezone: 'Asia/Bangkok' })
    // 16:00Z -> 23:00 BKK = inside.
    expect(applyQuietHours(bkk, ['u1'], new Date('2026-01-15T16:00:00.000Z'))).toEqual([])
    // 08:00Z -> 15:00 BKK = outside.
    expect(applyQuietHours(bkk, ['u1'], new Date('2026-01-15T08:00:00.000Z'))).toEqual(['u1'])
  })

  it('disabled policy is a no-op even inside the window', () => {
    expect(applyQuietHours(policy({ enabled: false }), ['u1'], inside)).toEqual(['u1'])
  })

  it('absent policy is a no-op', () => {
    expect(applyQuietHours(null, ['u1'], inside)).toEqual(['u1'])
  })
})

describe('applyMaxRate — caps the Nth push per user', () => {
  it('caps a user at max_rate_per_user_per_hour pushes', async () => {
    const p = policy({ max_rate_per_user_per_hour: 3 })
    // First 3 pass, the 4th is dropped.
    expect(await applyMaxRate(p, ['u1'])).toEqual(['u1'])
    expect(await applyMaxRate(p, ['u1'])).toEqual(['u1'])
    expect(await applyMaxRate(p, ['u1'])).toEqual(['u1'])
    expect(await applyMaxRate(p, ['u1'])).toEqual([])
  })

  it('throttles per user independently', async () => {
    const p = policy({ max_rate_per_user_per_hour: 1 })
    expect(await applyMaxRate(p, ['a', 'b'])).toEqual(['a', 'b'])
    expect(await applyMaxRate(p, ['a', 'b'])).toEqual([])
  })

  it('cap of 0 disables rate enforcement (no-op)', async () => {
    const p = policy({ max_rate_per_user_per_hour: 0 })
    for (let i = 0; i < 5; i++) {
      expect(await applyMaxRate(p, ['u1'])).toEqual(['u1'])
    }
  })

  it('absent policy is a no-op', async () => {
    for (let i = 0; i < 5; i++) {
      expect(await applyMaxRate(null, ['u1'])).toEqual(['u1'])
    }
  })
})

describe('selectPushTargets — wired enforcement', () => {
  const inside = new Date('2026-01-15T23:30:00.000Z').getTime()
  const outside = new Date('2026-01-15T12:00:00.000Z').getTime()

  it('drops everyone during org quiet hours', async () => {
    const pool = fakePool({ policyJson: JSON.stringify(policy()) })
    expect(await selectPushTargets(pool, ['u1', 'u2'], 'ch1', inside)).toEqual([])
  })

  it('passes targets outside quiet hours', async () => {
    const pool = fakePool({ policyJson: JSON.stringify(policy()) })
    const out = await selectPushTargets(pool, ['u1', 'u2'], 'ch1', outside)
    expect(out).toContain('u1')
    expect(out).toContain('u2')
  })

  it('caps the Nth push via max_rate', async () => {
    const pool = fakePool({
      policyJson: JSON.stringify(policy({ max_rate_per_user_per_hour: 2 })),
    })
    expect(await selectPushTargets(pool, ['u1'], 'ch1', outside)).toEqual(['u1'])
    expect(await selectPushTargets(pool, ['u1'], 'ch1', outside)).toEqual(['u1'])
    expect(await selectPushTargets(pool, ['u1'], 'ch1', outside)).toEqual([])
  })

  it('absent policy is a no-op (passes during what would be quiet hours)', async () => {
    const pool = fakePool() // no system_config row
    const out = await selectPushTargets(pool, ['u1', 'u2'], 'ch1', inside)
    expect(out).toContain('u1')
    expect(out).toContain('u2')
  })

  it('disabled policy is a no-op', async () => {
    const pool = fakePool({ policyJson: JSON.stringify(policy({ enabled: false })) })
    const out = await selectPushTargets(pool, ['u1'], 'ch1', inside)
    expect(out).toContain('u1')
  })
})
