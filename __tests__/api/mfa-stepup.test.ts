/**
 * Integration test for MFA step-up after SSO (enforce_mfa).
 *
 * A provider with enforce_mfa=true must leave the SSO session mfa_pending, so
 * readSessionUserId rejects it until POST /api/auth/mfa/stepup verifies a TOTP
 * code. Providers without enforce_mfa log in normally.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, asRequest, cleanupTestData,
  TestContext, TestUser,
} from '../helpers'
import type { SsoProviderConfig } from '@/lib/auth/ssoProvider'
import type { MappedIdentity } from '@/lib/auth/ssoClaims'
import { loginViaSso } from '@/lib/auth/ssoProvision'
import { readSessionUserId } from '@/lib/auth/session'
import { generateTotpSecret, totpCode } from '@/lib/auth/totp'

let ctx: TestContext
let userWithMfa: TestUser
let userNoMfa: TestUser
let enforceProviderId: string
let plainProviderId: string
const knownSecret = generateTotpSecret()
const createdIds: string[] = []
const providerIds: string[] = []

const meta = { ip: '127.0.0.1', userAgent: 'vitest' }

function setCookie(sessionCookie: string) {
  ;(globalThis as { __TEST_COOKIE_HEADER__?: string }).__TEST_COOKIE_HEADER__ = sessionCookie
}

async function insertProvider(enforceMfa: boolean): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(`
    INSERT INTO aaelink.sso_providers
      (id, name, type, issuer, metadata_url, discovery_url,
       client_id, client_secret_hash, client_secret_enc, callback_url, scopes,
       jit_provisioning, default_role, default_workspace_id,
       attribute_mapping, group_role_mapping,
       saml_entry_point, saml_idp_cert, saml_audience,
       session_lifetime_hours, enforce_mfa, is_active,
       login_count, last_login_at, created_by, created_at, updated_at)
    VALUES ($1, $2, 'oidc', 'https://idp', '', '',
            'cid', '', '', '/cb', 'openid',
            false, 'member', NULL,
            '{}', '{}',
            '', '', '',
            24, $3, true,
            0, 0, $4, $5, $5)
  `, [id, `prov-${id.slice(0, 8)}`, enforceMfa, userWithMfa.id, Date.now()])
  providerIds.push(id)
  return id
}

function cfgFor(id: string, enforceMfa: boolean): SsoProviderConfig {
  return {
    id, name: 'prov', type: 'oidc', issuer: 'https://idp', discoveryUrl: '',
    clientId: 'cid', scopes: 'openid', jitProvisioning: false, defaultRole: 'member',
    defaultWorkspaceId: null, attributeMapping: {}, groupRoleMapping: {},
    samlEntryPoint: '', samlIdpCert: '', samlIdpCerts: [], samlAudience: '', isActive: true,
    enforceMfa, clientSecret: '',
  }
}

function identityFor(u: TestUser): MappedIdentity {
  return {
    subject: `sub-${u.id.slice(0, 8)}`, email: u.email,
    firstName: 'T', lastName: 'U', displayName: 'T U', groups: [],
  }
}

beforeAll(async () => {
  ctx = await createTestContext()
  userWithMfa = await createTestUser(ctx.pool, { role: 'employee' })
  userNoMfa = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(userWithMfa.id, userNoMfa.id)

  // userWithMfa already has an active TOTP factor with a code we can compute.
  await ctx.pool.query(`
    INSERT INTO aaelink.mfa_enrollments
      (id, user_id, method, secret_hash, is_active, is_verified, created_at, last_used_at)
    VALUES ($1, $2, 'totp', $3, true, true, $4, 0)
  `, [randomUUID(), userWithMfa.id, knownSecret, Date.now()])

  enforceProviderId = await insertProvider(true)
  plainProviderId = await insertProvider(false)
})

afterAll(async () => {
  setCookie('')
  if (providerIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.sso_identity_links WHERE provider_id = ANY($1)`, [providerIds])
    await ctx.pool.query(`DELETE FROM aaelink.audit_log WHERE resource_id = ANY($1)`, [providerIds])
    await ctx.pool.query(`DELETE FROM aaelink.sso_providers WHERE id = ANY($1)`, [providerIds])
  }
  await ctx.pool.query(`DELETE FROM aaelink.mfa_enrollments WHERE user_id = ANY($1)`, [createdIds])
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [createdIds])
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('SSO login without enforce_mfa', () => {
  it('creates a fully usable session (no step-up)', async () => {
    const res = await loginViaSso(ctx.pool, cfgFor(plainProviderId, false), identityFor(userWithMfa), meta)
    expect(res!.mfaPending).toBe(false)
    setCookie(`AAELINK_SESSION=${res!.sessionId}`)
    expect(await readSessionUserId()).toBe(userWithMfa.id)
  })
})

describe('SSO login with enforce_mfa — user has TOTP', () => {
  it('withholds the session until a valid TOTP step-up', async () => {
    const res = await loginViaSso(ctx.pool, cfgFor(enforceProviderId, true), identityFor(userWithMfa), meta)
    expect(res!.mfaPending).toBe(true)

    // Session is hidden from normal routes while pending.
    setCookie(`AAELINK_SESSION=${res!.sessionId}`)
    expect(await readSessionUserId()).toBeNull()

    const { POST } = await import('@/app/api/auth/mfa/stepup/route')

    // Wrong code keeps the session pending.
    const bad = await POST(asRequest('POST', '/api/auth/mfa/stepup', {
      cookie: `AAELINK_SESSION=${res!.sessionId}`, body: { action: 'verify', code: '000000' },
    }))
    expect(bad.status).toBe(400)
    setCookie(`AAELINK_SESSION=${res!.sessionId}`)
    expect(await readSessionUserId()).toBeNull()

    // Correct code clears the gate.
    const ok = await POST(asRequest('POST', '/api/auth/mfa/stepup', {
      cookie: `AAELINK_SESSION=${res!.sessionId}`, body: { action: 'verify', code: totpCode(knownSecret) },
    }))
    expect(ok.status).toBe(200)
    setCookie(`AAELINK_SESSION=${res!.sessionId}`)
    expect(await readSessionUserId()).toBe(userWithMfa.id)
  })
})

describe('SSO login with enforce_mfa — user has no factor', () => {
  it('enrolls via begin then verifies to clear the gate', async () => {
    const res = await loginViaSso(ctx.pool, cfgFor(enforceProviderId, true), identityFor(userNoMfa), meta)
    expect(res!.mfaPending).toBe(true)
    const cookie = `AAELINK_SESSION=${res!.sessionId}`

    const { POST } = await import('@/app/api/auth/mfa/stepup/route')

    const begin = await POST(asRequest('POST', '/api/auth/mfa/stepup', { cookie, body: { action: 'begin' } }))
    expect(begin.status).toBe(201)
    const setup = (await begin.json()) as { enrolled: boolean; setup: { secret: string } }
    expect(setup.enrolled).toBe(false)

    const verify = await POST(asRequest('POST', '/api/auth/mfa/stepup', {
      cookie, body: { action: 'verify', code: totpCode(setup.setup.secret) },
    }))
    expect(verify.status).toBe(200)
    setCookie(cookie)
    expect(await readSessionUserId()).toBe(userNoMfa.id)
  })

  it('rejects step-up with no pending session', async () => {
    const { POST } = await import('@/app/api/auth/mfa/stepup/route')
    const res = await POST(asRequest('POST', '/api/auth/mfa/stepup', { body: { action: 'begin' } }))
    expect(res.status).toBe(401)
  })
})
