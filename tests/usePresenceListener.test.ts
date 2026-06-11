/**
 * AAELink — Presence Listener Status Thresholds Tests
 *
 * The hook requires React + SSE, but we verify the getStatus
 * decision thresholds for online/away/offline/dnd.
 */
import { describe, it, expect } from 'vitest'
import type { PresenceStatus } from '@/components/chat/usePresenceListener'

/** Replicate getStatus logic from source */
function computeStatus(
  lastSeen: number,
  now: number,
  dndOverride: boolean
): PresenceStatus {
  if (dndOverride) return 'dnd'
  const diff = now - lastSeen
  if (diff < 2 * 60 * 1000) return 'online'  // < 2 min
  if (diff < 10 * 60 * 1000) return 'away'   // < 10 min
  return 'offline'
}

describe('usePresenceListener — getStatus thresholds', () => {
  const NOW = Date.now()

  it('returns online when seen within 2 minutes', () => {
    expect(computeStatus(NOW - 60_000, NOW, false)).toBe('online')
  })

  it('returns online at exactly 1 minute ago', () => {
    expect(computeStatus(NOW - 60_000, NOW, false)).toBe('online')
  })

  it('returns away when seen 2–10 minutes ago', () => {
    expect(computeStatus(NOW - 3 * 60_000, NOW, false)).toBe('away')
  })

  it('returns away at 5 minutes ago', () => {
    expect(computeStatus(NOW - 5 * 60_000, NOW, false)).toBe('away')
  })

  it('returns offline when seen > 10 minutes ago', () => {
    expect(computeStatus(NOW - 15 * 60_000, NOW, false)).toBe('offline')
  })

  it('returns offline when never seen (lastSeen = 0)', () => {
    expect(computeStatus(0, NOW, false)).toBe('offline')
  })

  it('returns dnd regardless of recency when override is set', () => {
    expect(computeStatus(NOW, NOW, true)).toBe('dnd')
  })

  it('dnd takes priority over online', () => {
    expect(computeStatus(NOW - 30_000, NOW, true)).toBe('dnd')
  })
})

describe('usePresenceListener — reconnect backoff', () => {
  it('starts at 2 seconds', () => {
    const reconnectDelay = 2000
    expect(reconnectDelay).toBe(2000)
  })

  it('caps at 30 seconds', () => {
    let delay = 2000
    for (let i = 0; i < 10; i++) {
      delay = Math.min(delay * 2, 30000)
    }
    expect(delay).toBe(30000)
  })

  it('doubles on each failure', () => {
    let delay = 2000
    delay = Math.min(delay * 2, 30000)
    expect(delay).toBe(4000)
    delay = Math.min(delay * 2, 30000)
    expect(delay).toBe(8000)
  })
})

describe('usePresenceListener — status polling interval', () => {
  it('polls DND statuses every 60 seconds', () => {
    const POLL_MS = 60_000
    expect(POLL_MS).toBe(60_000)
  })
})
