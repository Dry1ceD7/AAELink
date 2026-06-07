/**
 * AAELink — selectPushTargets unit tests.
 *
 * Tests that manual user_status='dnd' suppresses push targets, while expired
 * dnd status and other statuses (online, away) do not.
 *
 * The pg pool is injected so no live DB is required.
 */
import { describe, it, expect, vi } from 'vitest'
import type { Pool } from 'pg'
import { selectPushTargets } from '@/lib/notifications/pushTargeting'

/**
 * Build a minimal fake pool that handles the three queries issued by
 * selectPushTargets: channel mutes, dnd_settings, and user_status.
 */
function fakePool(opts: {
  mutedIds?: string[]
  dndSettingsRows?: { user_id: string; enabled: boolean; start_time: string; end_time: string; timezone: string; snooze_until: string }[]
  statusRows?: { user_id: string }[]
}): Pool {
  return {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      // Channel mutes / notification prefs query
      if (/channel_notification_prefs/.test(sql)) {
        const ids = opts.mutedIds ?? []
        return { rows: ids.map(id => ({ user_id: id })) }
      }
      // dnd_settings query
      if (/dnd_settings/.test(sql)) {
        return { rows: opts.dndSettingsRows ?? [] }
      }
      // user_status dnd query
      if (/user_status/.test(sql)) {
        return { rows: opts.statusRows ?? [] }
      }
      return { rows: [] }
    }),
  } as unknown as Pool
}

const NOW = 1_700_000_000_000 // fixed ms epoch

describe('selectPushTargets — manual status dnd suppresses push', () => {
  it('drops a user whose status=dnd with expires_at=0 (never-expires)', async () => {
    const pool = fakePool({
      statusRows: [{ user_id: 'u1' }],
    })
    const result = await selectPushTargets(pool, ['u1', 'u2'], 'ch1', NOW)
    expect(result).not.toContain('u1')
    expect(result).toContain('u2')
  })

  it('does NOT drop a user whose dnd status has expired (expires_at in past)', async () => {
    // The DB query already filters by expires_at > now, so an expired row
    // won't be returned. Simulate that by returning no status rows.
    const pool = fakePool({
      statusRows: [], // expired row filtered out by SQL
    })
    const result = await selectPushTargets(pool, ['u1'], 'ch1', NOW)
    expect(result).toContain('u1')
  })

  it('does not drop users with status online or away', async () => {
    // online/away rows are not returned by the SQL (status = 'dnd' filter)
    const pool = fakePool({
      statusRows: [],
    })
    const result = await selectPushTargets(pool, ['u-online', 'u-away'], 'ch1', NOW)
    expect(result).toContain('u-online')
    expect(result).toContain('u-away')
  })

  it('drops user with active dnd_settings snooze independently of user_status', async () => {
    const pool = fakePool({
      dndSettingsRows: [{
        user_id: 'u-snooze',
        enabled: false,
        start_time: '09:00',
        end_time: '17:00',
        timezone: 'UTC',
        snooze_until: String(NOW + 60_000), // snooze still active
      }],
    })
    const result = await selectPushTargets(pool, ['u-snooze', 'u-normal'], 'ch1', NOW)
    expect(result).not.toContain('u-snooze')
    expect(result).toContain('u-normal')
  })

  it('user_status dnd query receives correct now parameter', async () => {
    const pool = fakePool({ statusRows: [] })
    await selectPushTargets(pool, ['u1'], 'ch1', NOW)
    const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls
    const statusCall = calls.find((args: unknown[]) => /user_status/.test(args[0] as string))
    expect(statusCall).toBeDefined()
    // Second param array: [userIds, now]
    expect((statusCall as unknown[][])[1][1]).toBe(NOW)
  })
})
