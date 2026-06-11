/**
 * Integration test: CSRF double-submit enforcement on message mutations.
 *
 * verifyCsrf is FAIL-CLOSED for authenticated sessions: once an AAELINK_SESSION
 * cookie is present, a mutating request must carry a signed AAELINK_CSRF cookie
 * AND a matching x-csrf-token header (login mints the cookie via
 * attachCsrfCookie). Unauthenticated/first-contact requests are exempt.
 *
 * These tests pass noAutoCsrf so the harness does not auto-attach a token — they
 * drive the cookie/header by hand. The final test proves the harness auto-attach
 * keeps ordinary authenticated mutations working.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createHmac } from 'crypto'
import {
  createTestContext, createTestUser, asRequest, expectError, cleanupTestData,
  TestContext, TestUser,
} from '../helpers'
import { __resetCsrfSecretForTests } from '@/lib/auth/csrf'

const SECRET = 'test-csrf-secret'
const SAVED = process.env.CSRF_SECRET

function makeToken(): string {
  const raw = 'a1b2c3'.repeat(10)
  const sig = createHmac('sha256', SECRET).update(raw).digest('hex').slice(0, 16)
  return `${raw}.${sig}`
}
const TOKEN = makeToken()

let ctx: TestContext
let user: TestUser
const createdIds: string[] = []

async function isCsrfError(res: Response): Promise<boolean> {
  const body = await res.json().catch(() => ({})) as { error?: string }
  return /^csrf_/.test(String(body.error || ''))
}

beforeAll(async () => {
  process.env.CSRF_SECRET = SECRET
  __resetCsrfSecretForTests()
  ctx = await createTestContext()
  user = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(user.id)
})

afterAll(async () => {
  if (SAVED === undefined) delete process.env.CSRF_SECRET
  else process.env.CSRF_SECRET = SAVED
  __resetCsrfSecretForTests()
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('CSRF enforcement on POST /api/messages (fail-closed)', () => {
  it('rejects an authenticated mutation with NO csrf cookie/header at all', async () => {
    const { POST } = await import('@/app/api/messages/route')
    const res = await POST(asRequest('POST', '/api/messages', {
      cookie: user.sessionCookie, noAutoCsrf: true, body: { channel_id: 'x', message: 'hi' },
    }))
    await expectError(res, 403, 'csrf_token_invalid')
  })

  it('rejects when the csrf cookie is present but the header is missing', async () => {
    const { POST } = await import('@/app/api/messages/route')
    const res = await POST(asRequest('POST', '/api/messages', {
      cookie: `${user.sessionCookie}; AAELINK_CSRF=${TOKEN}`, noAutoCsrf: true,
      body: { channel_id: 'x', message: 'hi' },
    }))
    await expectError(res, 403, 'csrf_token_missing')
  })

  it('rejects when the header does not match the cookie', async () => {
    const { POST } = await import('@/app/api/messages/route')
    const res = await POST(asRequest('POST', '/api/messages', {
      cookie: `${user.sessionCookie}; AAELINK_CSRF=${TOKEN}`, noAutoCsrf: true,
      headers: { 'x-csrf-token': 'wrong.token' }, body: { channel_id: 'x', message: 'hi' },
    }))
    await expectError(res, 403, 'csrf_token_mismatch')
  })

  it('passes the CSRF gate when cookie and header match a valid token', async () => {
    const { POST } = await import('@/app/api/messages/route')
    const res = await POST(asRequest('POST', '/api/messages', {
      cookie: `${user.sessionCookie}; AAELINK_CSRF=${TOKEN}`, noAutoCsrf: true,
      headers: { 'x-csrf-token': TOKEN }, body: {}, // → invalid_input, not a CSRF error
    }))
    expect(await isCsrfError(res)).toBe(false)
  })

  it('does NOT require CSRF for an unauthenticated request (no session cookie)', async () => {
    const { POST } = await import('@/app/api/messages/route')
    const res = await POST(asRequest('POST', '/api/messages', { noAutoCsrf: true, body: {} }))
    // verifyCsrf skips (no session); handler then rejects as unauthorized.
    expect(res.status).toBe(401)
    expect(await isCsrfError(res)).toBe(false)
  })

  it('harness auto-attaches CSRF so ordinary authenticated mutations pass the gate', async () => {
    const { POST } = await import('@/app/api/messages/route')
    const res = await POST(asRequest('POST', '/api/messages', {
      cookie: user.sessionCookie, body: {}, // no manual CSRF → harness adds it
    }))
    expect(await isCsrfError(res)).toBe(false)
  })
})
