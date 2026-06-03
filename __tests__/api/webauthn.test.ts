/**
 * Integration test for WebAuthn passkeys (ADR 0016).
 *
 * The @simplewebauthn/server crypto is mocked (fabricating a real authenticator
 * attestation in a test is impractical); everything else is real — challenge
 * issue/consume, credential persistence, counter update, MFA-step-up gating.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'crypto'
import {
  createTestContext, createTestUser, asRequest, expectSuccess, expectError, cleanupTestData,
  TestContext, TestUser,
} from '../helpers'

vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn(async () => ({ challenge: 'reg-challenge', rp: {}, user: {} })),
  verifyRegistrationResponse: vi.fn(async () => ({
    verified: true,
    registrationInfo: {
      credential: { id: 'cred-AAA', publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] },
      credentialDeviceType: 'multiDevice',
      credentialBackedUp: true,
    },
  })),
  generateAuthenticationOptions: vi.fn(async () => ({
    challenge: 'auth-challenge',
    allowCredentials: [{ id: 'cred-AAA' }],
  })),
  verifyAuthenticationResponse: vi.fn(async () => ({
    verified: true,
    authenticationInfo: { credentialID: 'cred-AAA', newCounter: 5 },
  })),
}))
import * as swa from '@simplewebauthn/server'

let ctx: TestContext
let user: TestUser
const createdIds: string[] = []

function setCookie(c: string) {
  ;(globalThis as { __TEST_COOKIE_HEADER__?: string }).__TEST_COOKIE_HEADER__ = c
}

/** Pull a Set-Cookie value by name from a Response (tracedRoute returns Response, not NextResponse). */
function setCookieValue(res: Response, name: string): string | undefined {
  const all = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
    ?? [res.headers.get('set-cookie') ?? '']
  for (const line of all) {
    const m = line.match(new RegExp(`(?:^|, )${name}=([^;]*)`))
    if (m) return m[1]
  }
  return undefined
}

async function makePendingSession(userId: string): Promise<string> {
  const sid = randomUUID()
  const now = Date.now()
  await ctx.pool.query(
    `INSERT INTO aaelink.sessions (id, user_id, expires_at, user_agent, ip_address, created_at, last_active_at, mfa_pending)
     VALUES ($1,$2,$3,'vitest','127.0.0.1',$4,$4,true)`,
    [sid, userId, now + 86_400_000, now]
  )
  return sid
}

beforeAll(async () => {
  ctx = await createTestContext()
  user = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(user.id)
})

afterAll(async () => {
  setCookie('')
  await ctx.pool.query(`DELETE FROM aaelink.webauthn_credentials WHERE user_id = ANY($1)`, [createdIds])
  await ctx.pool.query(`DELETE FROM aaelink.webauthn_challenges WHERE user_id = ANY($1)`, [createdIds])
  await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [createdIds])
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('passkey registration', () => {
  it('rejects unauthenticated begin', async () => {
    const { POST } = await import('@/app/api/auth/webauthn/register/route')
    const res = await POST(asRequest('POST', '/api/auth/webauthn/register', { body: { action: 'begin' } }))
    expect(res.status).toBe(401)
  })

  it('begin issues options and stores a challenge', async () => {
    const { POST } = await import('@/app/api/auth/webauthn/register/route')
    const res = await POST(asRequest('POST', '/api/auth/webauthn/register', {
      cookie: user.sessionCookie, body: { action: 'begin' },
    }))
    const body = await expectSuccess<{ options: { challenge: string } }>(res)
    expect(body.options.challenge).toBe('reg-challenge')
    const { rows } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.webauthn_challenges WHERE user_id = $1 AND kind = 'register'`, [user.id]
    )
    expect(rows.length).toBe(1)
  })

  it('finish verifies and persists the credential, consuming the challenge', async () => {
    const { POST } = await import('@/app/api/auth/webauthn/register/route')
    const res = await POST(asRequest('POST', '/api/auth/webauthn/register', {
      cookie: user.sessionCookie,
      body: { action: 'finish', response: { id: 'cred-AAA' }, name: 'My Phone' },
    }))
    expect(res.status).toBe(201)
    const { rows } = await ctx.pool.query<{ credential_id: string; public_key: string; name: string }>(
      `SELECT credential_id, public_key, name FROM aaelink.webauthn_credentials WHERE user_id = $1`, [user.id]
    )
    expect(rows[0].credential_id).toBe('cred-AAA')
    expect(rows[0].public_key).toBe(Buffer.from([1, 2, 3]).toString('base64'))
    expect(rows[0].name).toBe('My Phone')
    // challenge consumed
    const { rows: chal } = await ctx.pool.query(
      `SELECT 1 FROM aaelink.webauthn_challenges WHERE user_id = $1 AND kind = 'register'`, [user.id]
    )
    expect(chal.length).toBe(0)
  })

  it('lists the registered passkey', async () => {
    const { GET } = await import('@/app/api/auth/webauthn/register/route')
    const res = await GET(asRequest('GET', '/api/auth/webauthn/register', { cookie: user.sessionCookie }))
    const body = await expectSuccess<{ passkeys: Array<{ name: string }> }>(res)
    expect(body.passkeys.some(p => p.name === 'My Phone')).toBe(true)
  })

  it('finish fails when verification returns false', async () => {
    vi.mocked(swa.verifyRegistrationResponse).mockResolvedValueOnce({ verified: false } as never)
    const { POST } = await import('@/app/api/auth/webauthn/register/route')
    const res = await POST(asRequest('POST', '/api/auth/webauthn/register', {
      cookie: user.sessionCookie, body: { action: 'begin' },
    }))
    await expectSuccess(res) // re-issue a challenge
    const fin = await POST(asRequest('POST', '/api/auth/webauthn/register', {
      cookie: user.sessionCookie, body: { action: 'finish', response: { id: 'cred-BBB' } },
    }))
    await expectError(fin, 400, 'verification_failed')
  })
})

describe('passkey MFA step-up', () => {
  it('verifies an assertion and clears mfa_pending', async () => {
    const { readSessionUserId } = await import('@/lib/auth/session')
    const sid = await makePendingSession(user.id)
    const cookie = `AAELINK_SESSION=${sid}`

    // Pending session is hidden from normal routes.
    setCookie(cookie)
    expect(await readSessionUserId()).toBeNull()

    const { POST } = await import('@/app/api/auth/webauthn/authenticate/route')

    const begin = await POST(asRequest('POST', '/api/auth/webauthn/authenticate', {
      cookie, body: { action: 'begin' },
    }))
    const bOpts = await expectSuccess<{ options: { allowCredentials: unknown[] } }>(begin)
    expect(bOpts.options.allowCredentials.length).toBeGreaterThan(0)

    const finish = await POST(asRequest('POST', '/api/auth/webauthn/authenticate', {
      cookie, body: { action: 'finish', response: { id: 'cred-AAA' } },
    }))
    await expectSuccess(finish)

    // Gate cleared: counter updated, session now usable.
    const { rows } = await ctx.pool.query<{ counter: string }>(
      `SELECT counter FROM aaelink.webauthn_credentials WHERE user_id = $1`, [user.id]
    )
    expect(Number(rows[0].counter)).toBe(5)
    setCookie(cookie)
    expect(await readSessionUserId()).toBe(user.id)
  })

  it('keeps the session pending when verification fails', async () => {
    vi.mocked(swa.verifyAuthenticationResponse).mockResolvedValueOnce({ verified: false } as never)
    const { readSessionUserId } = await import('@/lib/auth/session')
    const sid = await makePendingSession(user.id)
    const cookie = `AAELINK_SESSION=${sid}`
    const { POST } = await import('@/app/api/auth/webauthn/authenticate/route')

    await POST(asRequest('POST', '/api/auth/webauthn/authenticate', { cookie, body: { action: 'begin' } }))
    const finish = await POST(asRequest('POST', '/api/auth/webauthn/authenticate', {
      cookie, body: { action: 'finish', response: { id: 'cred-AAA' } },
    }))
    await expectError(finish, 400, 'verification_failed')
    setCookie(cookie)
    expect(await readSessionUserId()).toBeNull()
  })
})

describe('passwordless passkey login', () => {
  it('begin returns options and stashes the challenge cookie', async () => {
    const { POST } = await import('@/app/api/auth/webauthn/login/route')
    const res = await POST(asRequest('POST', '/api/auth/webauthn/login', { body: { action: 'begin' } }))
    const body = await expectSuccess<{ options: { challenge: string } }>(res)
    expect(body.options.challenge).toBe('auth-challenge')
    expect(setCookieValue(res, 'WEBAUTHN_LOGIN_CHALLENGE')).toBe('auth-challenge')
  })

  it('finish verifies, resolves the user, and establishes a session', async () => {
    const { readSessionUserId } = await import('@/lib/auth/session')
    const { POST } = await import('@/app/api/auth/webauthn/login/route')
    const res = await POST(asRequest('POST', '/api/auth/webauthn/login', {
      cookie: 'WEBAUTHN_LOGIN_CHALLENGE=auth-challenge',
      body: { action: 'finish', response: { id: 'cred-AAA' } },
    }))
    const body = await expectSuccess<{ user_id: string }>(res)
    expect(body.user_id).toBe(user.id)

    // A real, non-pending session cookie was set and resolves to the user.
    const sid = setCookieValue(res, 'AAELINK_SESSION')
    expect(sid).toBeTruthy()
    setCookie(`AAELINK_SESSION=${sid}`)
    expect(await readSessionUserId()).toBe(user.id)
  })

  it('rejects finish without a challenge cookie', async () => {
    const { POST } = await import('@/app/api/auth/webauthn/login/route')
    const res = await POST(asRequest('POST', '/api/auth/webauthn/login', {
      body: { action: 'finish', response: { id: 'cred-AAA' } },
    }))
    await expectError(res, 400, 'no_login_challenge')
  })

  it('rejects an unknown credential', async () => {
    const { POST } = await import('@/app/api/auth/webauthn/login/route')
    const res = await POST(asRequest('POST', '/api/auth/webauthn/login', {
      cookie: 'WEBAUTHN_LOGIN_CHALLENGE=auth-challenge',
      body: { action: 'finish', response: { id: 'cred-DOES-NOT-EXIST' } },
    }))
    await expectError(res, 401, 'invalid_passkey')
  })
})
