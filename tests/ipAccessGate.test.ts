/**
 * AAELink — IP allowlist gate unit tests (Admin parity §31).
 *
 * Pure-Node coverage of the gate's fail-open contract and cache control. The
 * full DB-backed enforcement behavior (blocked/allowed/disabled/exempt) is in
 * __tests__/api/ip-access.test.ts where a live Postgres is available.
 *
 * Here DATABASE_URL is deliberately unset so getPool() returns null and the
 * gate must FAIL OPEN — a transient/absent DB must never lock the platform out.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import {
  enforceIpAllowlist,
  loadIpAccessConfig,
  invalidateIpAccessCache,
  IP_ACCESS_CONFIG_KEY,
} from '@/lib/auth/ipAccessGate'

const savedDbUrl = process.env.DATABASE_URL

beforeEach(() => {
  delete process.env.DATABASE_URL
  invalidateIpAccessCache()
})

function req(ip: string, path = '/api/messages'): NextRequest {
  return new NextRequest(new URL(path, 'http://localhost:3040'), {
    headers: { 'x-forwarded-for': ip },
  })
}

describe('ipAccessGate — exported contract', () => {
  it('exposes a stable system_config key', () => {
    expect(IP_ACCESS_CONFIG_KEY).toBe('ip_access_config')
  })
})

describe('ipAccessGate — fail open without DB', () => {
  it('loadIpAccessConfig returns null when no pool is available', async () => {
    expect(await loadIpAccessConfig()).toBeNull()
  })

  it('enforceIpAllowlist allows the request (returns null) when config cannot load', async () => {
    const res = await enforceIpAllowlist(req('8.8.8.8'), '/api/messages')
    expect(res).toBeNull()
  })
})

describe('ipAccessGate — cache control', () => {
  it('invalidateIpAccessCache does not throw and forces a reload path', async () => {
    expect(() => invalidateIpAccessCache()).not.toThrow()
    // After invalidation, with no DB the loader still fails open.
    expect(await loadIpAccessConfig()).toBeNull()
  })

  it.runIf(savedDbUrl !== undefined)('restores DATABASE_URL for downstream suites', () => {
    if (savedDbUrl !== undefined) process.env.DATABASE_URL = savedDbUrl
    expect(process.env.DATABASE_URL).toBe(savedDbUrl)
  })
})
