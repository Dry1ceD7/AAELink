/**
 * Integration test: MFA backup (recovery) codes clear the step-up gate.
 *
 * A backup code is accepted wherever a TOTP code is (POST /api/auth/mfa/stepup
 * action=verify). It is single-use: the second attempt with the same code is
 * rejected. TOTP still works against the same user, and a wrong/garbage code is
 * rejected. Mirrors __tests__/api/mfa-stepup.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, asRequest, cleanupTestData,
  type TestContext, type TestUser,
} from '../helpers'
import type { SsoProviderConfig } from '@/lib/auth/ssoProvider'
import type { MappedIdentity } from '@/lib/auth/ssoClaims'
import { loginViaSso } from '@/lib/auth/ssoProvision'
import { readSessionUserId } from '@/lib/auth/session'
import { generateTotpSecret, totpCode } from '@/lib/auth/totp'
import { hashBackupCode } from '@/lib/auth/backupCodes'

let ctx: TestContext
let user: TestUser
let enforceProviderId: string
const knownSecret = generateTotpSecret()
const createdIds: string[] = []
const providerIds: string[] = []
const meta = { ip: '127.0.0.1', userAgent: 'vitest' }

const backupCodes = Array.from({ length: 10 }, () =>
  `${randomUUID().slice(0, 4)}-${randomUUID().slice(0, 4)}`.toUpperCase()
)

function setCookie(cookie: string) {
  ;(globalThis as { __TEST_COOKIE_HEADER__?: string }).__TEST_COOKIE_HEADER__ = cookie
}

async function insertProvider(): Promise<string> {
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
            24, true, true,
            0, 0, $3, $4, $4)
  `, [id, `prov-${id.slice(0, 8)}`, user.id, Date.now()])
  providerIds.push(id)
  return id
}

function cfgFor(id: string): SsoProviderConfig {
  return {
    id, name: 'prov', type: 'oidc', issuer: 'https://idp', discoveryUrl: '',
    clientId: 'cid', scopes: 'openid', jitProvisioning: false, defaultRole: 'member',
    defaultWorkspaceId: null, attributeMapping: {}, groupRoleMapping: {},
    samlEntryPoint: '', samlIdpCert: '', samlIdpCerts: [], samlAudience: '', isActive: true,
    enforceMfa: true, clientSecret: '',
  }
}

function identityFor(u: TestUser): MappedIdentity {
  return {
    subject: `sub-${u.id.slice(0, 8)}`, email: u.email,
    firstName: 'T', lastName: 'U', displayName: 'T U', groups: [],
  }
}

/** Open a fresh enforce_mfa SSO session left mfa_pending; return its cookie. */
async function pendingSession(): Promise<string> {
  const res = await loginViaSso(ctx.pool, cfgFor(enforceProviderId), identityFor(user), meta)
  expect(res!.mfaPending).toBe(true)
  return `AAELINK_SESSION=${res!.sessionId}`
}

beforeAll(async () => {
  ctx = await createTestContext()
  user = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(user.id)

  // Active TOTP factor (computable code) + active backup-codes factor.
  await ctx.pool.query(`
    INSERT INTO aaelink.mfa_enrollments
      (id, user_id, method, secret_hash, is_active, is_verified, created_at, last_used_at)
    VALUES ($1, $2, 'totp', $3, true, true, $4, 0)
  `, [randomUUID(), user.id, knownSecret, Date.now()])
  await ctx.pool.query(`
    INSERT INTO aaelink.mfa_enrollments
      (id, user_id, method, secret_hash, is_active, is_verified, created_at, last_used_at)
    VALUES ($1, $2, 'backup_codes', $3, true, true, $4, 0)
  `, [randomUUID(), user.id, JSON.stringify(backupCodes.map((c) => hashBackupCode(c))), Date.now()])

  enforceProviderId = await insertProvider()
})

afterAll(async () => {
  setCookie('')
  if (providerIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.sso_identity_links WHERE provider_id = ANY($1)`, [providerIds])
    await ctx.pool.query(`DELETE FROM aaelink.sso_providers WHERE id = ANY($1)`, [providerIds])
  }
  await ctx.pool.query(`DELETE FROM aaelink.audit_log WHERE actor_id = ANY($1)`, [createdIds])
  await ctx.pool.query(`DELETE FROM aaelink.mfa_enrollments WHERE user_id = ANY($1)`, [createdIds])
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [createdIds])
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('MFA step-up with a backup code', () => {
  it('accepts a backup code once and clears the gate', async () => {
    const cookie = await pendingSession()
    setCookie(cookie)
    expect(await readSessionUserId()).toBeNull()

    const { POST } = await import('@/app/api/auth/mfa/stepup/route')
    const res = await POST(asRequest('POST', '/api/auth/mfa/stepup', {
      cookie, body: { action: 'verify', code: backupCodes[0] },
    }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { method?: string; backup_codes_remaining?: number }
    expect(body.method).toBe('backup_code')
    expect(body.backup_codes_remaining).toBe(9)

    setCookie(cookie)
    expect(await readSessionUserId()).toBe(user.id)
  })

  it('rejects reuse of the same backup code', async () => {
    const cookie = await pendingSession()
    const { POST } = await import('@/app/api/auth/mfa/stepup/route')
    const res = await POST(asRequest('POST', '/api/auth/mfa/stepup', {
      cookie, body: { action: 'verify', code: backupCodes[0] },
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_code')
    setCookie(cookie)
    expect(await readSessionUserId()).toBeNull()
  })

  it('still accepts a valid TOTP code', async () => {
    const cookie = await pendingSession()
    const { POST } = await import('@/app/api/auth/mfa/stepup/route')
    const res = await POST(asRequest('POST', '/api/auth/mfa/stepup', {
      cookie, body: { action: 'verify', code: totpCode(knownSecret) },
    }))
    expect(res.status).toBe(200)
    setCookie(cookie)
    expect(await readSessionUserId()).toBe(user.id)
  })

  it('rejects a wrong / garbage code', async () => {
    const cookie = await pendingSession()
    const { POST } = await import('@/app/api/auth/mfa/stepup/route')
    const res = await POST(asRequest('POST', '/api/auth/mfa/stepup', {
      cookie, body: { action: 'verify', code: 'ZZZZ-ZZZZ' },
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_code')
    setCookie(cookie)
    expect(await readSessionUserId()).toBeNull()
  })

  it('writes a mfa.backup_code_used audit row on success', async () => {
    const cookie = await pendingSession()
    const { POST } = await import('@/app/api/auth/mfa/stepup/route')
    const res = await POST(asRequest('POST', '/api/auth/mfa/stepup', {
      cookie, body: { action: 'verify', code: backupCodes[1] },
    }))
    expect(res.status).toBe(200)
    // audit write is best-effort/async; poll briefly.
    let found = 0
    for (let i = 0; i < 10 && found === 0; i++) {
      const { rows } = await ctx.pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM aaelink.audit_log
          WHERE actor_id = $1 AND action = 'mfa.backup_code_used'`,
        [user.id]
      )
      found = Number(rows[0].n)
      if (found === 0) await new Promise((r) => setTimeout(r, 50))
    }
    expect(found).toBeGreaterThan(0)
  })
})
