/**
 * Integration tests — IP allowlist enforcement wiring in tracedRoute (Admin parity §31).
 *
 * Gap: lib/api/tracedRoute.ts wires enforceIpAllowlist at ~line 101-115, but no
 * test drove a real route THROUGH tracedRoute, so deleting that call would pass
 * all existing tests. These tests cover:
 *
 *   (a) Enabled allowlist, non-matching IP  → real tracedRoute-wrapped route
 *       returns 403 ip_not_allowed.
 *   (b) Enabled allowlist, matching IP      → same route passes (not 403).
 *   (c) Exempt prefix /api/admin/ip-access  → passes despite blocking config.
 *   (d) Exempt prefix /api/auth/sso/...     → passes despite blocking config.
 *   (e) Disabled config                     → passes regardless of IP.
 *
 * The "normal route" is GET /api/channels (tracedRoute-wrapped, returns 401 for
 * unauthenticated callers). The IP gate fires BEFORE auth in tracedRoute, so a
 * blocked IP returns 403 even for an unauthenticated request — which is distinct
 * from the 401 a passing IP returns. That asymmetry is the detection mechanism.
 *
 * Client IP is injected via the x-forwarded-for header that extractClientIp reads.
 * invalidateIpAccessCache() is called after every config change so the 30 s TTL
 * cache does not mask the new config.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import {
  createTestContext, asRequest, TestContext,
} from '../helpers'
import {
  invalidateIpAccessCache,
  IP_ACCESS_CONFIG_KEY,
} from '@/lib/auth/ipAccessGate'

let ctx: TestContext

async function clearConfig() {
  await ctx.pool.query(
    `DELETE FROM aaelink.system_config WHERE key = $1`,
    [IP_ACCESS_CONFIG_KEY],
  )
  invalidateIpAccessCache()
}

async function writeBlockingConfig(allowlist: string[] = ['203.0.113.0/24']) {
  await ctx.pool.query(`
    INSERT INTO aaelink.system_config (key, value, updated_at)
    VALUES ($1, $2, $3)
    ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3
  `, [
    IP_ACCESS_CONFIG_KEY,
    JSON.stringify({ allowlistEnabled: true, allowlist, allowPrivateNetworks: false }),
    Date.now(),
  ])
  invalidateIpAccessCache()
}

/** Build a GET request with an explicit client IP set via x-forwarded-for. */
function reqWithIp(path: string, ip: string) {
  return asRequest('GET', path, { headers: { 'x-forwarded-for': ip } })
}

beforeAll(async () => { ctx = await createTestContext() })

afterEach(async () => { await clearConfig() })

afterAll(async () => {
  await clearConfig()
  await ctx.cleanup()
})

// ── (a) Enabled allowlist, non-matching IP ───────────────────────────────────

describe('tracedRoute IP enforcement — non-matching IP is blocked', () => {
  it('returns 403 ip_not_allowed for a blocked IP on a normal route', async () => {
    await writeBlockingConfig(['203.0.113.0/24'])

    // Import the real tracedRoute-wrapped GET handler for /api/channels.
    // This ensures the test fails if enforceIpAllowlist is removed from tracedRoute.
    const { GET } = await import('@/app/api/channels/route')
    const res = await GET(reqWithIp('/api/channels', '8.8.8.8') as never, {} as never)

    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('ip_not_allowed')
  })

  it('IP gate fires before auth — unauthenticated blocked request gets 403 not 401', async () => {
    await writeBlockingConfig(['203.0.113.0/24'])

    const { GET } = await import('@/app/api/channels/route')
    // No session cookie — without the IP gate this would be 401.
    const res = await GET(reqWithIp('/api/channels', '1.2.3.4') as never, {} as never)

    // Must be 403 (IP gate) not 401 (auth gate) — proves ordering.
    expect(res.status).toBe(403)
  })
})

// ── (b) Enabled allowlist, matching IP passes ────────────────────────────────

describe('tracedRoute IP enforcement — matching IP passes gate', () => {
  it('returns non-403 for an IP that is on the allowlist', async () => {
    await writeBlockingConfig(['203.0.113.0/24'])

    const { GET } = await import('@/app/api/channels/route')
    const res = await GET(reqWithIp('/api/channels', '203.0.113.42') as never, {} as never)

    // Should NOT be 403 ip_not_allowed; the gate passes and auth runs (→ 401).
    expect(res.status).not.toBe(403)
    // Confirm it proceeds to the auth layer.
    expect(res.status).toBe(401)
  })
})

// ── (c) Exempt prefix /api/admin/ip-access passes despite blocking config ────

describe('tracedRoute IP enforcement — /api/admin/ip-access is exempt', () => {
  it('allows a blocked IP to reach the ip-access admin route (lockout-prevention)', async () => {
    await writeBlockingConfig(['203.0.113.0/24'])

    const { GET } = await import('@/app/api/admin/ip-access/route')
    const res = await GET(reqWithIp('/api/admin/ip-access', '8.8.8.8') as never, {} as never)

    // Gate is exempt → request reaches auth layer → 401 (no session), not 403.
    expect(res.status).not.toBe(403)
    expect(res.status).toBe(401)
  })
})

// ── (d) Exempt prefix /api/auth/sso/... passes despite blocking config ───────
//
// tracedRoute calls isIpAllowlistExempt(routePath) BEFORE enforceIpAllowlist.
// There is no live route registered at /api/auth/sso/* in the test process, so
// we verify the exempt logic by wrapping a trivial handler with tracedRoute
// using the SSO routePath — this is the same code path the real SSO handler
// uses, and confirms the exemption survives the full tracedRoute wrapper.

describe('tracedRoute IP enforcement — /api/auth/sso/* is exempt', () => {
  it('allows a blocked IP through a tracedRoute handler registered at /api/auth/sso/*', async () => {
    await writeBlockingConfig(['203.0.113.0/24'])

    const { tracedRoute } = await import('@/lib/api/tracedRoute')
    const { NextResponse } = await import('next/server')

    // Wrap a minimal handler at the SSO routePath. If the exemption is present,
    // the IP gate is skipped and the handler runs, returning 200. If the
    // exemption is removed from tracedRoute, the gate fires first → 403.
    const ssoHandler = tracedRoute(
      'GET',
      '/api/auth/sso/callback',
      async () => NextResponse.json({ ok: true }, { status: 200 }),
    )
    const req = reqWithIp('/api/auth/sso/callback', '8.8.8.8')
    const res = await ssoHandler(req as never, {} as never)

    // Exempt → handler runs → 200, not 403 ip_not_allowed.
    expect(res.status).not.toBe(403)
    expect(res.status).toBe(200)
  })
})

// ── (e) Disabled config — all IPs pass ──────────────────────────────────────

describe('tracedRoute IP enforcement — disabled config passes all IPs', () => {
  it('passes a non-allowlisted IP when allowlist is disabled', async () => {
    await ctx.pool.query(`
      INSERT INTO aaelink.system_config (key, value, updated_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3
    `, [
      IP_ACCESS_CONFIG_KEY,
      JSON.stringify({ allowlistEnabled: false, denylistEnabled: false, allowlist: [] }),
      Date.now(),
    ])
    invalidateIpAccessCache()

    const { GET } = await import('@/app/api/channels/route')
    const res = await GET(reqWithIp('/api/channels', '8.8.8.8') as never, {} as never)

    // Gate disabled → not 403; auth runs → 401.
    expect(res.status).not.toBe(403)
    expect(res.status).toBe(401)
  })

  it('passes when no config row exists (fail-open)', async () => {
    // clearConfig() already deleted the row in afterEach; call it explicitly here.
    await clearConfig()

    const { GET } = await import('@/app/api/channels/route')
    const res = await GET(reqWithIp('/api/channels', '8.8.8.8') as never, {} as never)

    expect(res.status).not.toBe(403)
    expect(res.status).toBe(401)
  })
})
