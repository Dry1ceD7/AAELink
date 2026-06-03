/**
 * Integration tests for inbound SSO Relying-Party routes.
 *
 *   - GET  /api/auth/sso/oidc/start    — provider validation + redirect/fail
 *   - GET  /api/auth/sso/oidc/callback — generic failure on bad/missing state
 *   - GET  /api/auth/sso/saml/start    — provider validation
 *   - POST /api/auth/sso/saml/acs      — generic failure on bad RelayState
 *
 * These assert the security envelope (no oracle, generic /login?error=sso_failed
 * redirects, state/RelayState binding) without standing up a real IdP. Requires
 * a live Postgres (run via `bun run test:integration`).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, asRequest, cleanupTestData,
  type TestContext, type TestUser,
} from '../helpers'

let ctx: TestContext
let admin: TestUser
const createdIds: string[] = []
let oidcProviderId = ''
let samlProviderId = ''

beforeAll(async () => {
  process.env.AAELINK_SSO_SECRET_KEY = process.env.AAELINK_SSO_SECRET_KEY || 'integration-sso-key-please-rotate'
  ctx = await createTestContext()
  admin = await createTestUser(ctx.pool, { role: 'super_admin' })
  createdIds.push(admin.id)

  const { POST } = await import('@/app/api/auth/sso/route')
  const oidcRes = await POST(asRequest('POST', '/api/auth/sso', {
    cookie: admin.sessionCookie,
    body: {
      name: 'Test OIDC', type: 'oidc',
      issuer: 'https://idp.example.com',
      client_id: 'cid', client_secret: 'shh',
    },
  }))
  oidcProviderId = (await oidcRes.json()).provider.id

  const samlRes = await POST(asRequest('POST', '/api/auth/sso', {
    cookie: admin.sessionCookie,
    body: {
      name: 'Test SAML', type: 'saml',
      saml_entry_point: 'https://idp.example.com/sso',
      saml_idp_cert: 'MIIBfakecertbody',
      saml_audience: 'sp-entity',
    },
  }))
  samlProviderId = (await samlRes.json()).provider.id
})

afterAll(async () => {
  if (!ctx) return
  await ctx.pool.query(`DELETE FROM aaelink.sso_providers WHERE id = ANY($1::text[])`, [[oidcProviderId, samlProviderId].filter(Boolean)])
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

function redirectLocation(res: Response): string {
  return res.headers.get('location') || ''
}

describe('GET /api/auth/sso/oidc/start', () => {
  it('redirects to generic failure for an unknown provider', async () => {
    const { GET } = await import('@/app/api/auth/sso/oidc/start/route')
    const res = await GET(asRequest('GET', '/api/auth/sso/oidc/start', { query: { provider: 'does-not-exist' } }))
    expect(res.status).toBe(307)
    expect(redirectLocation(res)).toContain('/login?error=sso_failed')
  })
})

describe('GET /api/auth/sso/oidc/callback', () => {
  it('fails generically when state is missing (CSRF defense)', async () => {
    const { GET } = await import('@/app/api/auth/sso/oidc/callback/route')
    const res = await GET(asRequest('GET', '/api/auth/sso/oidc/callback', { query: { provider: oidcProviderId, code: 'abc' } }))
    expect(redirectLocation(res)).toContain('/login?error=sso_failed')
  })

  it('fails generically for a forged/unknown state', async () => {
    const { GET } = await import('@/app/api/auth/sso/oidc/callback/route')
    const res = await GET(asRequest('GET', '/api/auth/sso/oidc/callback', { query: { provider: oidcProviderId, code: 'abc', state: randomUUID() } }))
    expect(redirectLocation(res)).toContain('/login?error=sso_failed')
  })

  it('does not consume a state bound to a DIFFERENT provider', async () => {
    // Seed a pending oidc request for the saml provider id, then try to redeem
    // it against the oidc provider — must be rejected (provider binding).
    const state = randomUUID()
    await ctx.pool.query(
      `INSERT INTO aaelink.sso_auth_requests (id, provider_id, protocol, state, nonce, code_verifier, relay_state, redirect_uri, consumed_at, expires_at, created_at)
       VALUES ($1,$2,'oidc',$3,'n','v','','',0,$4,$5)`,
      [randomUUID(), samlProviderId, state, Date.now() + 60000, Date.now()]
    )
    const { GET } = await import('@/app/api/auth/sso/oidc/callback/route')
    const res = await GET(asRequest('GET', '/api/auth/sso/oidc/callback', { query: { provider: oidcProviderId, code: 'abc', state } }))
    expect(redirectLocation(res)).toContain('/login?error=sso_failed')
  })
})

describe('SAML routes', () => {
  it('start redirects to generic failure for an unknown provider', async () => {
    const { GET } = await import('@/app/api/auth/sso/saml/start/route')
    const res = await GET(asRequest('GET', '/api/auth/sso/saml/start', { query: { provider: 'nope' } }))
    expect(redirectLocation(res)).toContain('/login?error=sso_failed')
  })

  it('acs fails generically with no SAMLResponse', async () => {
    const { POST } = await import('@/app/api/auth/sso/saml/acs/route')
    const form = new FormData()
    form.set('RelayState', randomUUID())
    const url = new URL(`http://localhost:3040/api/auth/sso/saml/acs?provider=${samlProviderId}`)
    const req = new Request(url, { method: 'POST', body: form })
    const res = await POST(req)
    expect(redirectLocation(res)).toContain('/login?error=sso_failed')
  })

  it('acs fails generically for an unknown RelayState (replay/CSRF defense)', async () => {
    const { POST } = await import('@/app/api/auth/sso/saml/acs/route')
    const form = new FormData()
    form.set('SAMLResponse', Buffer.from('<x/>').toString('base64'))
    form.set('RelayState', randomUUID())
    const url = new URL(`http://localhost:3040/api/auth/sso/saml/acs?provider=${samlProviderId}`)
    const req = new Request(url, { method: 'POST', body: form })
    const res = await POST(req)
    expect(redirectLocation(res)).toContain('/login?error=sso_failed')
  })
})
