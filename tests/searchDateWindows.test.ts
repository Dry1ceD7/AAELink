/**
 * AAELink — search date-operator TIME ZONE contract (lib/messaging/searchEngine).
 *
 * before:/after:/on:/during: are interpreted in **UTC**, not server-local time.
 * dayWindow / duringWindow convert a YYYY-MM-DD[ / YYYY[-MM] ] to an epoch-ms
 * [start, endExclusive) window using a `Z`-suffixed Date / Date.UTC, so the bounds
 * are deterministic regardless of the process TZ. These assertions are pinned to
 * `Date.UTC(...)` (a TZ-independent reference) so they pass under any TZ env.
 */
import { describe, it, expect } from 'vitest'
import { dayWindow, duringWindow, isYmd } from '@/lib/messaging/searchEngine'

describe('dayWindow — UTC day bounds (TZ-independent)', () => {
  it('on:2025-03-04 → [UTC 2025-03-04, UTC 2025-03-05)', () => {
    const w = dayWindow('2025-03-04')!
    expect(w.start).toBe(Date.UTC(2025, 2, 4, 0, 0, 0, 0))
    expect(w.end).toBe(Date.UTC(2025, 2, 5, 0, 0, 0, 0))
    // Window is exactly one UTC day wide.
    expect(w.end - w.start).toBe(86_400_000)
  })

  it('start is UTC midnight regardless of the host time zone', () => {
    // Date.UTC is the canonical TZ-free reference; equality proves no local offset
    // crept in (a local-time parse would shift by the host UTC offset).
    const w = dayWindow('2026-12-31')!
    expect(w.start).toBe(Date.parse('2026-12-31T00:00:00.000Z'))
    expect(w.start).toBe(Date.UTC(2026, 11, 31))
  })

  it('returns null for malformed input', () => {
    expect(dayWindow('2025-3-4')).toBeNull()
    expect(dayWindow('not-a-date')).toBeNull()
    expect(dayWindow('')).toBeNull()
  })
})

describe('duringWindow — UTC year/month bounds (TZ-independent)', () => {
  it('during:2025 → whole UTC year', () => {
    const w = duringWindow('2025')!
    expect(w.start).toBe(Date.UTC(2025, 0, 1))
    expect(w.end).toBe(Date.UTC(2026, 0, 1))
  })

  it('during:2025-06 → whole UTC month', () => {
    const w = duringWindow('2025-06')!
    expect(w.start).toBe(Date.UTC(2025, 5, 1))
    expect(w.end).toBe(Date.UTC(2025, 6, 1))
  })

  it('during:2025-12 rolls over to next UTC year', () => {
    const w = duringWindow('2025-12')!
    expect(w.start).toBe(Date.UTC(2025, 11, 1))
    expect(w.end).toBe(Date.UTC(2026, 0, 1))
  })

  it('rejects an out-of-range month', () => {
    expect(duringWindow('2025-13')).toBeNull()
    expect(duringWindow('2025-00')).toBeNull()
  })

  it('rejects malformed specs', () => {
    expect(duringWindow('2025-6')).toBeNull()
    expect(duringWindow('20250')).toBeNull()
    expect(duringWindow('garbage')).toBeNull()
  })
})

describe('isYmd', () => {
  it('accepts YYYY-MM-DD only', () => {
    expect(isYmd('2025-01-01')).toBe(true)
    expect(isYmd('2025-1-1')).toBe(false)
    expect(isYmd('2025/01/01')).toBe(false)
  })
})
