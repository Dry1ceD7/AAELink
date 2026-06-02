/**
 * AAELink — Channel Archival Engine Tests
 */
import { describe, it, expect } from 'vitest'
import {
  ChannelArchivalEngine,
  DEFAULT_ARCHIVAL_POLICY,
} from '@/lib/channels/channelArchival'

const DAY_MS = 24 * 60 * 60 * 1000
const now = Date.now()

function makeChannel(overrides: Record<string, unknown> = {}) {
  return {
    id: `ch-${Math.random().toString(36).slice(2, 8)}`,
    name: 'test-channel',
    workspace_id: 'ws-1',
    last_activity_at: now - 100 * DAY_MS, // 100 days inactive
    member_count: 5,
    is_archived: false,
    ...overrides,
  }
}

describe('Channel Archival — Policy', () => {
  it('uses defaults', () => {
    const engine = new ChannelArchivalEngine()
    const policy = engine.getPolicy()
    expect(policy.inactivity_days).toBe(90)
    expect(policy.grace_period_days).toBe(7)
    expect(policy.enabled).toBe(true)
  })

  it('accepts custom policy', () => {
    const engine = new ChannelArchivalEngine({ inactivity_days: 30 })
    expect(engine.getPolicy().inactivity_days).toBe(30)
  })

  it('updates policy', () => {
    const engine = new ChannelArchivalEngine()
    engine.updatePolicy({ inactivity_days: 60 })
    expect(engine.getPolicy().inactivity_days).toBe(60)
  })
})

describe('Channel Archival — Evaluation', () => {
  it('marks inactive channels for archive', () => {
    const engine = new ChannelArchivalEngine({ inactivity_days: 90 })
    const channels = [makeChannel({ last_activity_at: now - 100 * DAY_MS })]
    const result = engine.evaluate(channels)
    expect(result[0].action).toBe('archive')
    expect(result[0].days_inactive).toBeGreaterThanOrEqual(100)
  })

  it('marks channels in grace period for warning', () => {
    const engine = new ChannelArchivalEngine({ inactivity_days: 90, grace_period_days: 10 })
    // 85 days = within (90 - 10 = 80) to 90 range → warn
    const channels = [makeChannel({ last_activity_at: now - 85 * DAY_MS })]
    const result = engine.evaluate(channels)
    expect(result[0].action).toBe('warn')
  })

  it('skips recently active channels', () => {
    const engine = new ChannelArchivalEngine({ inactivity_days: 90 })
    const channels = [makeChannel({ last_activity_at: now - 10 * DAY_MS })]
    const result = engine.evaluate(channels)
    expect(result[0].action).toBe('skip')
  })

  it('skips already archived channels', () => {
    const engine = new ChannelArchivalEngine()
    const channels = [makeChannel({ is_archived: true })]
    const result = engine.evaluate(channels)
    expect(result).toHaveLength(0)
  })

  it('skips exempt channels by ID', () => {
    const ch = makeChannel()
    const engine = new ChannelArchivalEngine({ exempt_channel_ids: [ch.id] })
    const result = engine.evaluate([ch])
    expect(result[0].is_exempt).toBe(true)
    expect(result[0].action).toBe('skip')
  })

  it('skips channels matching exempt patterns', () => {
    const engine = new ChannelArchivalEngine({ exempt_patterns: ['general', 'it-*'] })
    const channels = [
      makeChannel({ name: 'general' }),
      makeChannel({ name: 'it-helpdesk' }),
      makeChannel({ name: 'project-alpha' }),
    ]
    const result = engine.evaluate(channels)
    expect(result[0].is_exempt).toBe(true)
    expect(result[1].is_exempt).toBe(true)
    expect(result[2].is_exempt).toBe(false)
  })

  it('skips channels below min_members_to_archive', () => {
    const engine = new ChannelArchivalEngine({ min_members_to_archive: 10 })
    const channels = [makeChannel({ member_count: 3 })]
    const result = engine.evaluate(channels)
    expect(result[0].action).toBe('skip')
    expect(result[0].exempt_reason).toContain('below_min_members')
  })
})

describe('Channel Archival — Preview', () => {
  it('returns preview with no side effects', () => {
    const engine = new ChannelArchivalEngine({ inactivity_days: 90 })
    const channels = [
      makeChannel({ last_activity_at: now - 100 * DAY_MS }),
      makeChannel({ last_activity_at: now - 85 * DAY_MS }),
      makeChannel({ last_activity_at: now - 10 * DAY_MS }),
    ]
    const result = engine.preview(channels)
    expect(result.preview).toBe(true)
    expect(result.total_scanned).toBe(3)
    expect(result.archived).toBe(1)
  })
})

describe('Channel Archival — Execute', () => {
  it('archives and warns correctly', async () => {
    const engine = new ChannelArchivalEngine({ inactivity_days: 90, grace_period_days: 10 })
    const archived: string[] = []
    const warned: string[] = []

    const channels = [
      makeChannel({ id: 'ch-old', last_activity_at: now - 100 * DAY_MS }),
      makeChannel({ id: 'ch-grace', last_activity_at: now - 85 * DAY_MS }),
    ]

    const result = await engine.execute(
      channels,
      async (id) => { archived.push(id) },
      async (id) => { warned.push(id) },
    )

    expect(result.preview).toBe(false)
    expect(result.archived).toBe(1)
    expect(result.warned).toBe(1)
    expect(archived).toContain('ch-old')
    expect(warned).toContain('ch-grace')
  })

  it('respects disabled policy', async () => {
    const engine = new ChannelArchivalEngine({ enabled: false })
    const result = await engine.execute(
      [makeChannel()],
      async () => {},
      async () => {},
    )
    expect(result.archived).toBe(0)
    expect(result.errors).toContain('archival_disabled')
  })

  it('handles execution errors gracefully', async () => {
    const engine = new ChannelArchivalEngine({ inactivity_days: 90 })
    const result = await engine.execute(
      [makeChannel({ last_activity_at: now - 100 * DAY_MS })],
      async () => { throw new Error('db_error') },
      async () => {},
    )
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('db_error')
  })
})
