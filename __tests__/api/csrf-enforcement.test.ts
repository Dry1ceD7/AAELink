/**
 * Integration test: CSRF double-submit enforcement on message mutations.
 *
 * verifyCsrf only enforces once an AAELINK_CSRF cookie exists (the cookie is set
 * on page load), so requests without it are unaffected — but when the cookie IS
 * present, the x-csrf-token header must be present, signed, and match.
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

describe('CSRF enforcement on POST /api/messages', () => {
  it('rejects when a CSRF cookie is present but the header is missing', async () => {
    const { POST } = await import('@/app/api/messages/route')
    const res = await POST(asRequest('POST', '/api/messages', {
      cookie: `${user.sessionCookie}; AAELINK_CSRF=${TOKEN}`,
      body: { channel_id: 'x', message: 'hi' },
    }))
    await expectError(res, 403, 'csrf_token_missing')
  })

  it('rejects when the header does not match the cookie', async () => {
    const { POST } = await import('@/app/api/messages/route')
    const res = await POST(asRequest('POST', '/api/messages', {
      cookie: `${user.sessionCookie}; AAELINK_CSRF=${TOKEN}`,
      headers: { 'x-csrf-token': 'wrong.token' },
      body: { channel_id: 'x', message: 'hi' },
    }))
    await expectError(res, 403, 'csrf_token_mismatch')
  })

  it('passes the CSRF gate when cookie and header match a valid token', async () => {
    const { POST } = await import('@/app/api/messages/route')
    const res = await POST(asRequest('POST', '/api/messages', {
      cookie: `${user.sessionCookie}; AAELINK_CSRF=${TOKEN}`,
      headers: { 'x-csrf-token': TOKEN },
      body: {}, // missing channel_id/message → fails LATER with invalid_input, not a CSRF error
    }))
    // Past the CSRF guard: the failure must not be a csrf_* error.
    const body = await res.json().catch(() => ({})) as { error?: string }
    expect(String(body.error || '')).not.toMatch(/^csrf_/)
  })

  it('is a no-op when no CSRF cookie is set (header-less clients unaffected)', async () => {
    const { POST } = await import('@/app/api/messages/route')
    const res = await POST(asRequest('POST', '/api/messages', {
      cookie: user.sessionCookie,
      body: {}, // no CSRF cookie → guard skips → normal validation
    }))
    const body = await res.json().catch(() => ({})) as { error?: string }
    expect(String(body.error || '')).not.toMatch(/^csrf_/)
  })
})
