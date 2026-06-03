/**
 * Integration test for GET /api/calls/ice — ephemeral ICE/TURN credentials.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createHmac } from 'crypto'
import {
  createTestContext, createTestUser, asRequest, expectSuccess, cleanupTestData,
  TestContext, TestUser,
} from '../helpers'

let ctx: TestContext
let user: TestUser
const createdIds: string[] = []
const SAVED = { ...process.env }

beforeAll(async () => {
  ctx = await createTestContext()
  user = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(user.id)
})

afterAll(async () => {
  process.env = { ...SAVED }
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('GET /api/calls/ice', () => {
  it('returns 401 without a session', async () => {
    const { GET } = await import('@/app/api/calls/ice/route')
    const res = await GET(asRequest('GET', '/api/calls/ice'))
    expect(res.status).toBe(401)
  })

  it('returns STUN-only when no TURN secret is configured', async () => {
    delete process.env.TURN_STATIC_AUTH_SECRET
    const { GET } = await import('@/app/api/calls/ice/route')
    const res = await GET(asRequest('GET', '/api/calls/ice', { cookie: user.sessionCookie }))
    const body = await expectSuccess<{ ice_servers: Array<{ urls: unknown }>; turn_configured: boolean }>(res)
    expect(body.turn_configured).toBe(false)
    expect(body.ice_servers.length).toBe(1)
  })

  it('returns a TURN entry with a valid HMAC credential when configured', async () => {
    process.env.TURN_STATIC_AUTH_SECRET = 'integration-secret'
    process.env.TURN_URLS = 'turn:turn.aae.co.th:3478'
    const { GET } = await import('@/app/api/calls/ice/route')
    const res = await GET(asRequest('GET', '/api/calls/ice', { cookie: user.sessionCookie }))
    const body = await expectSuccess<{
      ice_servers: Array<{ urls: string | string[]; username?: string; credential?: string }>
      turn_configured: boolean; expires_at: number
    }>(res)

    expect(body.turn_configured).toBe(true)
    const turnEntry = body.ice_servers.find(s => s.username)!
    expect(turnEntry.username).toMatch(new RegExp(`^\\d+:${user.id}$`))
    // credential is base64(HMAC-SHA1(secret, username)) — recompute + compare.
    const expected = createHmac('sha1', 'integration-secret').update(turnEntry.username!).digest('base64')
    expect(turnEntry.credential).toBe(expected)
    // username's leading expiry is in the future.
    expect(Number(turnEntry.username!.split(':')[0])).toBe(body.expires_at)
    expect(body.expires_at * 1000).toBeGreaterThan(Date.now())
  })
})
