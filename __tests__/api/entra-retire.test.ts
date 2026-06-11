/**
 * Integration tests for the retired legacy /api/auth/entra entry point.
 *
 * The route no longer performs an Entra code exchange, creates users, or mints
 * sessions. It is a thin shim that hands off to the hardened inbound-SSO RP flow
 * (/api/auth/sso/oidc/start, ADR 0014), resolving the single active OIDC
 * provider so old bookmarks / desktop clients keep working. With no active OIDC
 * provider it funnels through the same generic /login?error=sso_failed redirect
 * as the rest of the SSO stack (no failure-mode oracle).
 *
 * Requires a live Postgres (run via the integration vitest config).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestContext, createTestUser, asRequest, cleanupTestData,
  type TestContext, type TestUser,
} from '../helpers'

let ctx: TestContext
let admin: TestUser
const createdIds: string[] = []
let oidcProviderId = ''

function redirectLocation(res: Response): string {
  return res.headers.get('location') || ''
}

beforeAll(async () => {
  process.env.AAELINK_SSO_SECRET_KEY = process.env.AAELINK_SSO_SECRET_KEY || 'integration-sso-key-please-rotate'
  ctx = await createTestContext()
  // Start from a clean provider table so "no provider" / "single provider"
  // assertions are deterministic across suites sharing this DB.
  await ctx.pool.query(`DELETE FROM aaelink.sso_providers`)
  admin = await createTestUser(ctx.pool, { role: 'super_admin' })
  createdIds.push(admin.id)
})

afterAll(async () => {
  if (!ctx) return
  await ctx.pool.query(`DELETE FROM aaelink.sso_providers WHERE id = $1`, [oidcProviderId]).catch(() => {})
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('GET /api/auth/entra (retired shim)', () => {
  it('hands off to the hardened RP start route even when no provider resolves', async () => {
    // With no active OIDC provider the shim still redirects into the hardened
    // start route (without a provider id); start owns the generic failure so the
    // legacy path never has its own failure-mode oracle.
    const { GET } = await import('@/app/api/auth/entra/route')
    const res = await GET(asRequest('GET', '/api/auth/entra'))
    expect([302, 307]).toContain(res.status)
    const loc = redirectLocation(res)
    expect(loc).toContain('/api/auth/sso/oidc/start')
    expect(loc).not.toContain('provider=')
  })

  it('start route emits the generic failure when no provider can be resolved', async () => {
    // The end-user result of the no-provider hand-off: generic /login?error=sso_failed.
    const { GET } = await import('@/app/api/auth/sso/oidc/start/route')
    const res = await GET(asRequest('GET', '/api/auth/sso/oidc/start'))
    expect(redirectLocation(res)).toContain('/login?error=sso_failed')
  })

  it('redirects into the hardened RP start route once an OIDC provider exists', async () => {
    // Register a real provider via the hardened admin route, then hit the shim.
    const { POST } = await import('@/app/api/auth/sso/route')
    const reg = await POST(asRequest('POST', '/api/auth/sso', {
      cookie: admin.sessionCookie,
      body: {
        name: 'Microsoft Entra ID', type: 'oidc',
        discovery_url: 'https://login.microsoftonline.com/tenant-xyz/v2.0/.well-known/openid-configuration',
        client_id: 'cid', client_secret: 'shh',
      },
    }))
    oidcProviderId = (await reg.json()).provider.id

    const { GET } = await import('@/app/api/auth/entra/route')
    const res = await GET(asRequest('GET', '/api/auth/entra'))
    expect([302, 307]).toContain(res.status)
    const loc = redirectLocation(res)
    expect(loc).toContain('/api/auth/sso/oidc/start')
    expect(loc).toContain(`provider=${oidcProviderId}`)
  })

  it('never sets a session cookie (no session minting)', async () => {
    const { GET } = await import('@/app/api/auth/entra/route')
    const res = await GET(asRequest('GET', '/api/auth/entra'))
    const setCookies = res.headers.getSetCookie?.() || []
    expect(setCookies.some((c) => c.startsWith('AAELINK_SESSION='))).toBe(false)
  })
})
