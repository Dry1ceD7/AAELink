/**
 * Integration test for SAML IdP metadata auto-discovery + cert rotation.
 *
 * The metadata FETCH is mocked (no network); the rest is real: admin route
 * persists entry point + signing-cert set on create, and the refresh route
 * re-fetches to rotate certs. ADR 0015.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import {
  createTestContext, createTestUser, asRequest, expectSuccess, expectError, cleanupTestData,
  TestContext, TestUser,
} from '../helpers'

const fetchMock = vi.fn()
vi.mock('@/lib/auth/samlMetadata', async (orig) => {
  const actual = await orig<typeof import('@/lib/auth/samlMetadata')>()
  return { ...actual, fetchSamlIdpMetadata: (...args: unknown[]) => fetchMock(...args) }
})

let ctx: TestContext
let admin: TestUser
let employee: TestUser
const createdIds: string[] = []
const providerIds: string[] = []

async function createProvider(cookie: string, body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/auth/sso/route')
  return POST(asRequest('POST', '/api/auth/sso', { cookie, body }))
}

beforeAll(async () => {
  ctx = await createTestContext()
  admin = await createTestUser(ctx.pool, { role: 'super_admin' })
  employee = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(admin.id, employee.id)
})

afterAll(async () => {
  if (providerIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.sso_providers WHERE id = ANY($1)`, [providerIds])
  }
  await ctx.pool.query(`DELETE FROM aaelink.audit_log WHERE actor_id = ANY($1)`, [createdIds])
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('SAML provider create via metadata_url', () => {
  it('populates entry point + signing certs from discovered metadata', async () => {
    fetchMock.mockResolvedValueOnce({
      entityId: 'https://idp.test/entity',
      entryPoint: 'https://idp.test/sso/redirect',
      certs: ['CERT_ONE', 'CERT_TWO'],
    })

    const res = await createProvider(admin.sessionCookie, {
      name: 'Okta SAML', type: 'saml', metadata_url: 'https://idp.test/metadata',
    })
    const body = await expectSuccess<{ provider: { id: string } }>(res)
    const id = body.provider.id
    providerIds.push(id)

    const { rows } = await ctx.pool.query<{
      saml_entry_point: string; saml_idp_cert: string; saml_idp_certs: string[]; issuer: string
    }>(`SELECT saml_entry_point, saml_idp_cert, saml_idp_certs, issuer FROM aaelink.sso_providers WHERE id = $1`, [id])
    expect(rows[0].saml_entry_point).toBe('https://idp.test/sso/redirect')
    expect(rows[0].saml_idp_cert).toBe('CERT_ONE')
    expect(rows[0].saml_idp_certs).toEqual(['CERT_ONE', 'CERT_TWO'])
    expect(rows[0].issuer).toBe('https://idp.test/entity')
  })

  it('returns 400 when metadata fetch fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('saml_metadata_fetch_failed_500'))
    const res = await createProvider(admin.sessionCookie, {
      name: 'Bad SAML', type: 'saml', metadata_url: 'https://idp.test/bad',
    })
    await expectError(res, 400, 'saml_metadata_fetch_failed')
  })
})

describe('SAML metadata refresh (cert rotation)', () => {
  it('rotates the signing-cert set from the provider metadata_url', async () => {
    fetchMock.mockResolvedValueOnce({
      entityId: 'https://idp.test/entity',
      entryPoint: 'https://idp.test/sso/redirect',
      certs: ['OLD_CERT'],
    })
    const created = await createProvider(admin.sessionCookie, {
      name: 'Rotate SAML', type: 'saml', metadata_url: 'https://idp.test/metadata',
    })
    const id = (await expectSuccess<{ provider: { id: string } }>(created)).provider.id
    providerIds.push(id)

    // IdP rolled keys: metadata now advertises old + new signing certs.
    fetchMock.mockResolvedValueOnce({
      entityId: 'https://idp.test/entity',
      entryPoint: 'https://idp.test/sso/redirect2',
      certs: ['OLD_CERT', 'NEW_CERT'],
    })
    const { POST } = await import('@/app/api/auth/sso/saml/refresh/route')
    const res = await POST(asRequest('POST', '/api/auth/sso/saml/refresh', {
      cookie: admin.sessionCookie, body: { provider_id: id },
    }))
    const body = await expectSuccess<{ cert_count: number; entry_point: string }>(res)
    expect(body.cert_count).toBe(2)
    expect(body.entry_point).toBe('https://idp.test/sso/redirect2')

    const { rows } = await ctx.pool.query<{ saml_idp_certs: string[]; saml_entry_point: string }>(
      `SELECT saml_idp_certs, saml_entry_point FROM aaelink.sso_providers WHERE id = $1`, [id]
    )
    expect(rows[0].saml_idp_certs).toEqual(['OLD_CERT', 'NEW_CERT'])
    expect(rows[0].saml_entry_point).toBe('https://idp.test/sso/redirect2')
  })

  it('forbids non-super-admins', async () => {
    const { POST } = await import('@/app/api/auth/sso/saml/refresh/route')
    const res = await POST(asRequest('POST', '/api/auth/sso/saml/refresh', {
      cookie: employee.sessionCookie, body: { provider_id: 'whatever' },
    }))
    await expectError(res, 403, 'super_admin_only')
  })
})
