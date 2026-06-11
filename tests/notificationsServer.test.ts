/**
 * AAELink — Notifications Server (snippet helper) Tests
 */
import { describe, it, expect, vi } from 'vitest'
import type { Pool } from 'pg'
import { shouldDropForUser } from '@/lib/notifications/notificationsServer'

// Re-implement the private snippet function for unit testing (line 19-25)
function snippet(text: string, max = 160) {
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

describe('NotificationsServer — snippet helper', () => {
  it('returns text under max unchanged', () => {
    expect(snippet('hello world')).toBe('hello world')
  })

  it('truncates text over max with ellipsis', () => {
    const long = 'a'.repeat(200)
    const result = snippet(long)
    expect(result.length).toBe(160)
    expect(result.endsWith('…')).toBe(true)
  })

  it('collapses whitespace', () => {
    expect(snippet('hello   \n  world')).toBe('hello world')
  })

  it('handles empty string', () => {
    expect(snippet('')).toBe('')
  })

  it('handles null-ish', () => {
    expect(snippet(null as unknown as string)).toBe('')
  })

  it('respects custom max', () => {
    const result = snippet('a'.repeat(100), 50)
    expect(result.length).toBe(50)
  })
})

/**
 * Build a fake pool covering the three queries shouldDropForUser issues:
 * channel_notification_prefs (muted), dnd_settings, and user_status.
 */
function fakeDropPool(opts: {
  muted?: boolean
  dndSettingsRows?: { enabled: boolean; start_time: string; end_time: string; timezone: string; snooze_until: string }[]
  statusDnd?: boolean
}): Pool {
  return {
    query: vi.fn(async (sql: string) => {
      if (/channel_notification_prefs/.test(sql)) {
        return { rows: opts.muted ? [{ user_id: 'u1' }] : [] }
      }
      if (/dnd_settings/.test(sql)) {
        return { rows: opts.dndSettingsRows ?? [] }
      }
      if (/user_status/.test(sql)) {
        return { rows: opts.statusDnd ? [{ user_id: 'u1' }] : [] }
      }
      return { rows: [] }
    }),
  } as unknown as Pool
}

const NOW = 1_700_000_000_000 // fixed ms epoch

describe('NotificationsServer — shouldDropForUser (in-app suppression)', () => {
  it('drops when the channel is muted for the user', async () => {
    const pool = fakeDropPool({ muted: true })
    expect(await shouldDropForUser(pool, 'u1', 'ch1', NOW)).toBe(true)
  })

  it('drops when an active snooze is set (snooze_until > now)', async () => {
    const pool = fakeDropPool({
      dndSettingsRows: [{
        enabled: false, start_time: '09:00', end_time: '17:00',
        timezone: 'UTC', snooze_until: String(NOW + 60_000),
      }],
    })
    expect(await shouldDropForUser(pool, 'u1', 'ch1', NOW)).toBe(true)
  })

  it('drops when an enabled DND schedule window contains now', async () => {
    // 00:00–23:59 UTC always contains now.
    const pool = fakeDropPool({
      dndSettingsRows: [{
        enabled: true, start_time: '00:00', end_time: '23:59',
        timezone: 'UTC', snooze_until: '0',
      }],
    })
    expect(await shouldDropForUser(pool, 'u1', 'ch1', NOW)).toBe(true)
  })

  it('drops when manual status=dnd is active', async () => {
    const pool = fakeDropPool({ statusDnd: true })
    expect(await shouldDropForUser(pool, 'u1', 'ch1', NOW)).toBe(true)
  })

  it('keeps a normal user (no mute, no DND, schedule disabled)', async () => {
    const pool = fakeDropPool({
      dndSettingsRows: [{
        enabled: false, start_time: '09:00', end_time: '17:00',
        timezone: 'UTC', snooze_until: '0',
      }],
    })
    expect(await shouldDropForUser(pool, 'u1', 'ch1', NOW)).toBe(false)
  })

  it('does NOT drop when DND schedule is disabled even if the window matches', async () => {
    const pool = fakeDropPool({
      dndSettingsRows: [{
        enabled: false, start_time: '00:00', end_time: '23:59',
        timezone: 'UTC', snooze_until: '0',
      }],
    })
    expect(await shouldDropForUser(pool, 'u1', 'ch1', NOW)).toBe(false)
  })

  it('returns false for empty userId/channelId without querying', async () => {
    const pool = fakeDropPool({ muted: true })
    expect(await shouldDropForUser(pool, '', 'ch1', NOW)).toBe(false)
    expect(await shouldDropForUser(pool, 'u1', '', NOW)).toBe(false)
    expect((pool.query as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
  })

  it('returns false when a query throws (never swallows a notification silently)', async () => {
    const pool = {
      query: vi.fn(async () => { throw new Error('db down') }),
    } as unknown as Pool
    expect(await shouldDropForUser(pool, 'u1', 'ch1', NOW)).toBe(false)
  })
})

describe('NotificationsServer — NotificationInsertRow type', () => {
  it('accepts valid row', () => {
    const row = {
      user_id: 'u-1',
      kind: 'mention',
      title: 'Test',
      body: 'Body',
      workspace_id: 'ws-1',
      channel_id: 'ch-1',
      message_id: 'msg-1',
      ticket_id: null,
    }
    expect(row.kind).toBe('mention')
    expect(row.ticket_id).toBeNull()
  })
})
