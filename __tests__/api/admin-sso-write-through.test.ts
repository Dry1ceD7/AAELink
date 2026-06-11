/**
 * Integration tests for the legacy Entra admin panel route /api/admin/sso.
 *
 * Review finding (high): the panel used to write Entra credentials ONLY to
 * aaelink.sso_configs, but the hardened login flow (ADR 0014) reads the OIDC
 * provider row in aaelink.sso_providers. After the one-time migration 031 seed,
 * an admin rotating the client secret here would save it to sso_configs while
 * the RP code exchange kept decrypting the STALE secret from sso_providers —
 * silently breaking every SSO login.
 *
 * The fix makes POST a write-THROUGH editor: it mirrors credentials into the
 * canonical 'Microsoft Entra ID' OIDC provider (re-encrypting the secret exactly
 * as POST /api/auth/sso does), and GET surfaces that provider id so the panel can
 * render the REAL callback URL. These tests pin that behaviour, including that
 * the RP loader decrypts back the rotated secret.
 *
 * Requires a live Postgres (run via the integration vitest config).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestContext, createTestUser, asRequest, cleanupTestData,
  type TestContext, type TestUser,
} from '../helpers'
import { loadActiveProvider } from '@/lib/auth/ssoProvider'

let ctx: TestContext
let admin: TestUser
let member: TestUser
const createdIds: string[] = []

beforeAll(async () => {
  process.env.AAELINK_SSO_SECRET_KEY = process.env.AAELINK_SSO_SECRET_KEY || 'integration-sso-key-please-rotate'
  ctx = await createTestContext()
  // Deterministic provider table for the single-provider assertions below.
  await ctx.pool.query(`DELETE FROM aaelink.sso_providers WHERE name = 'Microsoft Entra ID'`)
  await ctx.pool.query(`DELETE FROM aaelink.sso_configs WHERE provider = 'entra'`)
  admin = await createTestUser(ctx.pool, { role: 'super_admin' })
  member = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(admin.id, member.id)
})

afterAll(async () => {
  if (!ctx) return
  await ctx.pool.query(`DELETE FROM aaelink.sso_providers WHERE name = 'Microsoft Entra ID'`).catch(() => {})
  await ctx.pool.query(`DELETE FROM aaelink.sso_configs WHERE provider = 'entra'`).catch(() => {})
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('POST /api/admin/sso (write-through to sso_providers)', () => {
  it('rejects non-admins with 403', async () => {
    const { POST } = await import('@/app/api/admin/sso/route')
    const res = await POST(asRequest('POST', '/api/admin/sso', {
      cookie: member.sessionCookie,
      body: { tenant_id: 't', client_id: 'c', client_secret: 's', is_enabled: true },
    }))
    expect(res.status).toBe(403)
  })

  it('seeds the canonical OIDC provider the login flow reads', async () => {
    const { POST } = await import('@/app/api/admin/sso/route')
    const res = await POST(asRequest('POST', '/api/admin/sso', {
      cookie: admin.sessionCookie,
      body: { tenant_id: 'tenant-abc', client_id: 'app-1', client_secret: 'first-secret', is_enabled: true },
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.provider_id).toBe('string')
    expect(body.provider_id).not.toBe('')

    // The RP loader can read + decrypt the freshly written provider.
    const cfg = await loadActiveProvider(ctx.pool, body.provider_id, 'oidc')
    expect(cfg).not.toBeNull()
    expect(cfg?.clientId).toBe('app-1')
    expect(cfg?.clientSecret).toBe('first-secret')
    expect(cfg?.discoveryUrl).toBe(
      'https://login.microsoftonline.com/tenant-abc/v2.0/.well-known/openid-configuration'
    )
    expect(cfg?.isActive).toBe(true)
  })

  it('write-through keeps a rotated secret in sync with what the RP flow decrypts', async () => {
    const { POST, GET } = await import('@/app/api/admin/sso/route')
    // Rotate the secret + client id via the legacy panel.
    const rotate = await POST(asRequest('POST', '/api/admin/sso', {
      cookie: admin.sessionCookie,
      body: { tenant_id: 'tenant-abc', client_id: 'app-2', client_secret: 'rotated-secret', is_enabled: true },
    }))
    expect(rotate.status).toBe(200)
    const provId = (await rotate.json()).provider_id as string

    // No duplicate provider was created on update.
    const { rows } = await ctx.pool.query(
      `SELECT id FROM aaelink.sso_providers WHERE name = 'Microsoft Entra ID' AND type = 'oidc'`
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(provId)

    // The RP loader now sees the ROTATED secret (the whole point of the fix).
    const cfg = await loadActiveProvider(ctx.pool, provId, 'oidc')
    expect(cfg?.clientId).toBe('app-2')
    expect(cfg?.clientSecret).toBe('rotated-secret')

    // GET surfaces the same provider id so the panel renders the real callback.
    const getRes = await GET(asRequest('GET', '/api/admin/sso', { cookie: admin.sessionCookie }))
    expect(getRes.status).toBe(200)
    const getBody = await getRes.json()
    expect(getBody.provider_id).toBe(provId)
  })

  it('disabling in the panel deactivates the OIDC provider the login flow reads', async () => {
    const { POST } = await import('@/app/api/admin/sso/route')
    const res = await POST(asRequest('POST', '/api/admin/sso', {
      cookie: admin.sessionCookie,
      body: { tenant_id: 'tenant-abc', client_id: 'app-2', client_secret: 'rotated-secret', is_enabled: false },
    }))
    expect(res.status).toBe(200)
    const provId = (await res.json()).provider_id as string
    // is_active = false ⇒ loadActiveProvider refuses it (no inbound login).
    const cfg = await loadActiveProvider(ctx.pool, provId, 'oidc')
    expect(cfg).toBeNull()
  })

  it('rejects an incomplete config with 400', async () => {
    const { POST } = await import('@/app/api/admin/sso/route')
    const res = await POST(asRequest('POST', '/api/admin/sso', {
      cookie: admin.sessionCookie,
      body: { tenant_id: 'tenant-abc', client_id: '', client_secret: 's', is_enabled: true },
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('missing_required_fields')
  })
})
