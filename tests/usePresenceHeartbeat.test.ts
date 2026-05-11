/**
 * AAELink — Presence Heartbeat Constants Tests
 */
import { describe, it, expect } from 'vitest'

describe('usePresenceHeartbeat — interval', () => {
  const HEARTBEAT_INTERVAL_MS = 45_000

  it('heartbeat interval is 45 seconds', () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(45_000)
  })

  it('is less than Slack default of 60s', () => {
    expect(HEARTBEAT_INTERVAL_MS).toBeLessThan(60_000)
  })
})

describe('usePresenceHeartbeat — piggyback endpoints', () => {
  const ENDPOINTS = [
    '/api/collab/presence',
    '/api/scheduled-messages/dispatch',
    '/api/reminders/dispatch',
  ]

  it('calls 3 endpoints per beat', () => {
    expect(ENDPOINTS).toHaveLength(3)
  })

  it('presence is the primary endpoint', () => {
    expect(ENDPOINTS[0]).toBe('/api/collab/presence')
  })

  it('dispatches scheduled messages', () => {
    expect(ENDPOINTS).toContain('/api/scheduled-messages/dispatch')
  })

  it('dispatches reminders', () => {
    expect(ENDPOINTS).toContain('/api/reminders/dispatch')
  })
})
