/**
 * Integration tests for /api/auth/* routes
 *
 * Tests:
 *   - GET /api/auth/me — returns current user or 401
 *   - GET /api/auth/sessions — lists active sessions
 *   - MFA enrollment flow
 *   - SSO provider CRUD
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestContext, createTestUser, asRequest,
  expectSuccess, expectError, cleanupTestData,
  TestContext, TestUser
} from '../helpers'

let ctx: TestContext
let admin: TestUser
let employee: TestUser
const createdIds: string[] = []

beforeAll(async () => {
  ctx = await createTestContext()
  admin = await createTestUser(ctx.pool, { role: 'super_admin' })
  employee = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(admin.id, employee.id)
})

afterAll(async () => {
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('GET /api/auth/me', () => {
  it('returns 401 without session cookie', async () => {
    const { GET } = await import('@/app/api/auth/me/route')
    const req = asRequest('GET', '/api/auth/me')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns user data with valid session', async () => {
    const { GET } = await import('@/app/api/auth/me/route')
    const req = asRequest('GET', '/api/auth/me', { cookie: admin.sessionCookie })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await expectSuccess(res)
    expect(body).toHaveProperty('user')
  })
})

describe('GET /api/auth/sessions', () => {
  it('returns 401 without auth', async () => {
    const { GET } = await import('@/app/api/auth/sessions/route')
    const req = asRequest('GET', '/api/auth/sessions')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns session list for authenticated user', async () => {
    const { GET } = await import('@/app/api/auth/sessions/route')
    const req = asRequest('GET', '/api/auth/sessions', { cookie: admin.sessionCookie })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await expectSuccess<{ sessions: unknown[] }>(res)
    expect(Array.isArray(body.sessions)).toBe(true)
    expect(body.sessions.length).toBeGreaterThanOrEqual(1)
  })
})

describe('POST /api/auth/sso', () => {
  it('rejects non-admin users', async () => {
    const { POST } = await import('@/app/api/auth/sso/route')
    const req = asRequest('POST', '/api/auth/sso', {
      cookie: employee.sessionCookie,
      body: { action: 'create', provider_type: 'saml', name: 'Test SSO' },
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('creates SSO provider for admin', async () => {
    const { POST } = await import('@/app/api/auth/sso/route')
    const req = asRequest('POST', '/api/auth/sso', {
      cookie: admin.sessionCookie,
      body: {
        name: 'Test SSO Provider',
        type: 'saml',
        // Explicit entry point + cert (the non-metadata_url path) so create does
        // not attempt a live IdP metadata fetch. Metadata auto-discovery is
        // covered in __tests__/api/sso-saml-metadata.test.ts.
        saml_entry_point: 'https://idp.test/sso',
        saml_idp_cert: 'MIIBfakecertbody',
      },
    })
    const res = await POST(req)
    expect([200, 201]).toContain(res.status)
  })
})

describe('POST /api/auth/mfa', () => {
  it('starts TOTP enrollment', async () => {
    const { POST } = await import('@/app/api/auth/mfa/route')
    const req = asRequest('POST', '/api/auth/mfa', {
      cookie: employee.sessionCookie,
      body: { action: 'enroll_totp' },
    })
    const res = await POST(req)
    expect([200, 201]).toContain(res.status)
    const body = await expectSuccess<{ enrollment: Record<string, unknown>; setup: Record<string, unknown> }>(res)
    expect(body.enrollment).toHaveProperty('id')
    expect(body.setup).toHaveProperty('secret')
    expect(body.setup).toHaveProperty('otpauth_uri')
  })
})
