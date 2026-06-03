/**
 * AAELink — ephemeral TURN credential tests (pure, env-controlled).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createHmac } from 'crypto'
import { issueTurnCredentials, iceServersFor, turnConfigured } from '@/lib/calls/turnCredentials'

const SAVED = { ...process.env }
afterEach(() => {
  process.env = { ...SAVED }
})

const NOW = 1_700_000_000_000 // fixed ms

describe('issueTurnCredentials', () => {
  it('returns null when no shared secret is configured', () => {
    delete process.env.TURN_STATIC_AUTH_SECRET
    expect(issueTurnCredentials('user-1', NOW)).toBeNull()
    expect(turnConfigured()).toBe(false)
  })

  it('mints username=<expiry>:<uid> and base64 HMAC-SHA1 credential', () => {
    process.env.TURN_STATIC_AUTH_SECRET = 'shhh'
    process.env.TURN_CRED_TTL_SEC = '3600'
    const c = issueTurnCredentials('user-1', NOW)!
    const expectedExpiry = Math.floor(NOW / 1000) + 3600
    expect(c.username).toBe(`${expectedExpiry}:user-1`)
    expect(c.ttl).toBe(3600)
    const expected = createHmac('sha1', 'shhh').update(c.username).digest('base64')
    expect(c.credential).toBe(expected)
  })

  it('clamps absurdly small TTLs to a 60s floor', () => {
    process.env.TURN_STATIC_AUTH_SECRET = 'shhh'
    process.env.TURN_CRED_TTL_SEC = '1'
    expect(issueTurnCredentials('u', NOW)!.ttl).toBe(60)
  })
})

describe('iceServersFor', () => {
  it('returns STUN-only with turn=false when unconfigured', () => {
    delete process.env.TURN_STATIC_AUTH_SECRET
    const { iceServers, turn } = iceServersFor('user-1', NOW)
    expect(turn).toBe(false)
    expect(iceServers).toHaveLength(1)
    expect(iceServers[0].urls).toContain('stun:stun.l.google.com:19302')
  })

  it('appends a TURN entry with creds when configured', () => {
    process.env.TURN_STATIC_AUTH_SECRET = 'shhh'
    process.env.TURN_URLS = 'turn:turn.aae.co.th:3478,turns:turn.aae.co.th:5349'
    const { iceServers, turn } = iceServersFor('user-1', NOW)
    expect(turn).toBe(true)
    expect(iceServers).toHaveLength(2)
    const turnEntry = iceServers[1]
    expect(turnEntry.urls).toEqual(['turn:turn.aae.co.th:3478', 'turns:turn.aae.co.th:5349'])
    expect(turnEntry.username).toMatch(/^\d+:user-1$/)
    expect(turnEntry.credential).toBeTruthy()
  })
})
