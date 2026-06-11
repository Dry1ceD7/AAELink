/**
 * SLA v2 — business-hours forward walker.
 */
import { describe, it, expect } from 'vitest'
import {
  addBusinessMs, calculateSlaDueV2, effectiveDue, defaultPolicy,
  DEFAULT_BUSINESS_HOURS, type BusinessHours, type SlaPolicy,
} from '@/lib/enterprise/slaEngine'

const HOUR = 3_600_000
const MIN = 60_000

function bh(over: Partial<BusinessHours> = {}): BusinessHours {
  return {
    id: 'bh1',
    workspace_id: 'w',
    name: 'std',
    timezone: 'UTC',
    schedule: DEFAULT_BUSINESS_HOURS,
    holidays: [],
    ...over,
  }
}

describe('addBusinessMs — basic', () => {
  it('returns startMs when budget is zero', () => {
    const start = Date.UTC(2026, 0, 5, 10, 0) // Mon 10:00 UTC
    expect(addBusinessMs(start, 0, bh())).toBe(start)
  })

  it('advances within a single open window', () => {
    const start = Date.UTC(2026, 0, 5, 10, 0) // Mon 10:00
    const out = addBusinessMs(start, 2 * HOUR, bh())
    expect(out).toBe(start + 2 * HOUR)
  })

  it('rolls over weekend (Fri evening → Mon morning)', () => {
    const friNoon = Date.UTC(2026, 0, 2, 16, 0) // Fri 16:00 (1h until close)
    const out = addBusinessMs(friNoon, 2 * HOUR, bh())
    const monStart = Date.UTC(2026, 0, 5, 9, 0)
    expect(out).toBe(monStart + 1 * HOUR)
  })

  it('skips holidays', () => {
    const friNoon = Date.UTC(2026, 0, 2, 16, 0)
    const out = addBusinessMs(friNoon, 2 * HOUR, bh({ holidays: ['2026-01-05'] }))
    const tueStart = Date.UTC(2026, 0, 6, 9, 0)
    expect(out).toBe(tueStart + 1 * HOUR)
  })
})

describe('calculateSlaDueV2', () => {
  const policy: SlaPolicy = {
    id: 'p1', workspace_id: 'w', name: 'high', priority: 'high',
    first_response_ms: 2 * HOUR, resolution_ms: 8 * HOUR,
    pause_on_status: ['pending'], business_hours_id: null,
  }

  it('without BH returns simple add', () => {
    const start = 1_700_000_000_000
    const r = calculateSlaDueV2(start, policy, null)
    expect(r.first_response_due_at).toBe(start + 2 * HOUR)
    expect(r.resolution_due_at).toBe(start + 8 * HOUR)
  })

  it('with BH walks open windows only', () => {
    const friNoon = Date.UTC(2026, 0, 2, 16, 0) // Fri 16:00 (1h until close)
    const r = calculateSlaDueV2(friNoon, { ...policy, first_response_ms: 2 * HOUR, resolution_ms: 2 * HOUR }, bh())
    // 1h remains Fri + 1h Mon → Mon 10:00
    const expected = Date.UTC(2026, 0, 5, 10, 0)
    expect(r.first_response_due_at).toBe(expected)
    expect(r.resolution_due_at).toBe(expected)
  })
})

describe('effectiveDue — pause math', () => {
  it('adds completed pauses', () => {
    const due = 1000
    expect(effectiveDue(due, 250, 0, 5000)).toBe(1250)
  })
  it('adds pending pause segment', () => {
    const due = 1000
    expect(effectiveDue(due, 0, 800, 1000)).toBe(1200)
  })
})

describe('defaultPolicy', () => {
  it('produces a stable shape per priority', () => {
    const p = defaultPolicy('w', 'critical')
    expect(p.priority).toBe('critical')
    expect(p.first_response_ms).toBeGreaterThan(0)
    expect(p.resolution_ms).toBeGreaterThan(p.first_response_ms)
    expect(p.pause_on_status).toContain('pending')
  })
})
