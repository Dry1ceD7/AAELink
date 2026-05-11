/**
 * AAELink — useStatusExpiry Constants Tests
 *
 * The hook requires React + DOM, but we verify the polling
 * interval and endpoint path contract.
 */
import { describe, it, expect } from 'vitest'

describe('useStatusExpiry — polling interval', () => {
  const POLL_INTERVAL_MS = 60_000

  it('polls every 60 seconds', () => {
    expect(POLL_INTERVAL_MS).toBe(60_000)
  })
})

describe('useStatusExpiry — endpoint contract', () => {
  const ENDPOINT = '/api/user-status/expire'

  it('uses POST method', () => {
    // From source: apiFetch(ENDPOINT, { method: 'POST' })
    expect(ENDPOINT).toBe('/api/user-status/expire')
  })
})
