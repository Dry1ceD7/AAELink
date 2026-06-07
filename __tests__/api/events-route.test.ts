/**
 * Integration tests: Events API url_verification handshake.
 *
 * Covers:
 *   - POST creates subscription as pending when endpoint does not echo challenge
 *   - POST creates subscription as active when endpoint echoes challenge (JSON)
 *   - POST creates subscription as active when endpoint echoes challenge (plain text)
 *   - POST non-echoing endpoint → pending, verification:'failed' in response
 *   - PATCH action='verify' re-runs handshake; echoing endpoint flips to active
 *   - PATCH action='verify' on already-active → 409 already_verified
 *   - Unverified (pending) subscriptions are excluded from fanOutEventSubscriptions
 *   - Verified (active) subscriptions are included in fanOutEventSubscriptions
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'crypto'
import { promises as dns } from 'dns'
import {
  createTestContext, createTestUser, createTestChannel, asRequest,
  expectSuccess, cleanupTestData, TestContext, TestUser, TestChannel,
} from '../helpers'

let ctx: TestContext
let adminUser: TestUser
let channel: TestChannel
let wsId: string
const createdIds: string[] = []
const subIds: string[] = []

beforeAll(async () => {
  ctx = await createTestContext()
  adminUser = await createTestUser(ctx.pool, { role: 'super_admin' })
  createdIds.push(adminUser.id)
  const { rows: [m] } = await ctx.pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.workspace_members WHERE user_id = $1 LIMIT 1`,
    [adminUser.id]
  )
  wsId = m.workspace_id
  channel = await createTestChannel(ctx.pool, adminUser.id, { workspaceId: wsId })
})

afterAll(async () => {
  if (subIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.event_subscriptions WHERE id = ANY($1)`, [subIds])
  }
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

// Pin DNS for all tests — example.test does not resolve in CI
beforeEach(() => {
  vi.spyOn(dns, 'lookup').mockResolvedValue(
    [{ address: '93.184.216.34', family: 4 }] as never
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// Helper to capture subscription ids for cleanup
async function trackSub(res: Response): Promise<Record<string, unknown>> {
  const data = (await res.json()) as { subscription?: { id?: string } }
  if (data.subscription?.id) subIds.push(data.subscription.id)
  return data as Record<string, unknown>
}

// ── POST create with verification ────────────────────────────────────

describe('POST /api/integrations/events — url_verification on create', () => {
  it('creates active subscription when endpoint echoes challenge as JSON', async () => {
    let capturedBody: { type?: string; challenge?: string } | null = null

    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string) as { type?: string; challenge?: string }
      return new Response(
        JSON.stringify({ challenge: capturedBody.challenge }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }))

    const { POST } = await import('@/app/api/integrations/events/route')
    const res = await POST(asRequest('POST', '/api/integrations/events', {
      cookie: adminUser.sessionCookie,
      body: { endpoint_url: 'https://example.test/events', events: ['message.created'] },
    }))

    expect(res.status).toBe(201)
    const data = await trackSub(res)

    expect(capturedBody?.type).toBe('url_verification')
    expect(typeof capturedBody?.challenge).toBe('string')
    expect((data.subscription as Record<string, unknown>).status).toBe('active')
    expect((data.subscription as Record<string, unknown>).verified).toBe(true)
    expect(Number((data.subscription as Record<string, unknown>).verified_at)).toBeGreaterThan(0)
    expect(data.verification).toBeUndefined()
  })

  it('creates active subscription when endpoint echoes challenge as plain text', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { challenge?: string }
      // Respond with raw text — not JSON
      return new Response(body.challenge ?? '', { status: 200 })
    }))

    const { POST } = await import('@/app/api/integrations/events/route')
    const res = await POST(asRequest('POST', '/api/integrations/events', {
      cookie: adminUser.sessionCookie,
      body: { endpoint_url: 'https://example.test/events-txt', events: ['message.created'] },
    }))

    expect(res.status).toBe(201)
    const data = await trackSub(res)
    expect((data.subscription as Record<string, unknown>).status).toBe('active')
    expect((data.subscription as Record<string, unknown>).verified).toBe(true)
  })

  it('creates pending subscription when endpoint does not echo challenge', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ challenge: 'wrong_token' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    ))

    const { POST } = await import('@/app/api/integrations/events/route')
    const res = await POST(asRequest('POST', '/api/integrations/events', {
      cookie: adminUser.sessionCookie,
      body: { endpoint_url: 'https://example.test/bad-echo', events: ['message.created'] },
    }))

    expect(res.status).toBe(201)
    const data = await trackSub(res)
    expect((data.subscription as Record<string, unknown>).status).toBe('pending')
    expect((data.subscription as Record<string, unknown>).verified).toBe(false)
    expect(data.verification).toBe('failed')
    expect(typeof data.verification_detail).toBe('string')
  })

  it('creates pending subscription when endpoint times out', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) =>
      new Promise<never>((_res, reject) => {
        if (init.signal) {
          init.signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          })
        }
        setTimeout(() => (init.signal as AbortSignal & { dispatchEvent?: (e: Event) => void })?.dispatchEvent?.(new Event('abort')), 0)
      })
    ))

    const { POST } = await import('@/app/api/integrations/events/route')
    const res = await POST(asRequest('POST', '/api/integrations/events', {
      cookie: adminUser.sessionCookie,
      body: { endpoint_url: 'https://example.test/timeout', events: ['message.created'] },
    }))

    expect(res.status).toBe(201)
    const data = await trackSub(res)
    expect((data.subscription as Record<string, unknown>).status).toBe('pending')
    expect(data.verification).toBe('failed')
    expect(data.verification_detail).toBe('timeout')
  })
})

// ── PATCH re-verify ───────────────────────────────────────────────────

describe('PATCH /api/integrations/events — action=verify re-verify', () => {
  let pendingSubId: string

  beforeAll(async () => {
    // Create a pending subscription directly (no handshake)
    const id = randomUUID()
    const token = randomUUID().replace(/-/g, '')
    await ctx.pool.query(`
      INSERT INTO aaelink.event_subscriptions
        (id, bot_id, endpoint_url, events, signing_secret, status,
         verified, verification_token, verified_at,
         workspace_id, description, delivery_count, failure_count, created_by, created_at)
      VALUES ($1, NULL, 'https://example.test/re-verify', '["message.created"]',
              'whsec_seed', 'pending', false, $2, 0, $3, '', 0, 0, $4, $5)
    `, [id, token, wsId, adminUser.id, Date.now()])
    subIds.push(id)
    pendingSubId = id
  })

  it('flips pending→active when re-verify endpoint echoes the new challenge', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue(
      [{ address: '93.184.216.34', family: 4 }] as never
    )
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { challenge?: string }
      return new Response(JSON.stringify({ challenge: body.challenge }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))

    const { PATCH } = await import('@/app/api/integrations/events/route')
    const res = await PATCH(asRequest('PATCH', '/api/integrations/events', {
      cookie: adminUser.sessionCookie,
      body: { action: 'verify', subscription_id: pendingSubId },
    }))

    const data = await expectSuccess<{ subscription: { status: string; verified: boolean; verified_at: number } }>(res)
    expect(data.subscription.status).toBe('active')
    expect(data.subscription.verified).toBe(true)
    expect(data.subscription.verified_at).toBeGreaterThan(0)

    // Confirm in DB
    const { rows } = await ctx.pool.query<{ status: string; verified: boolean }>(
      `SELECT status, verified FROM aaelink.event_subscriptions WHERE id = $1`, [pendingSubId]
    )
    expect(rows[0].status).toBe('active')
    expect(rows[0].verified).toBe(true)
  })

  it('returns 409 already_verified when subscription is already active', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue(
      [{ address: '93.184.216.34', family: 4 }] as never
    )

    const { PATCH } = await import('@/app/api/integrations/events/route')
    const res = await PATCH(asRequest('PATCH', '/api/integrations/events', {
      cookie: adminUser.sessionCookie,
      body: { action: 'verify', subscription_id: pendingSubId },
    }))

    expect(res.status).toBe(409)
    const data = await res.json() as { error: string }
    expect(data.error).toBe('already_verified')
  })

  it('leaves subscription pending when re-verify endpoint does not echo', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue(
      [{ address: '93.184.216.34', family: 4 }] as never
    )

    // Create a fresh pending sub for this test
    const id = randomUUID()
    const token = randomUUID().replace(/-/g, '')
    await ctx.pool.query(`
      INSERT INTO aaelink.event_subscriptions
        (id, bot_id, endpoint_url, events, signing_secret, status,
         verified, verification_token, verified_at,
         workspace_id, description, delivery_count, failure_count, created_by, created_at)
      VALUES ($1, NULL, 'https://example.test/bad-re-verify', '["message.created"]',
              'whsec_seed2', 'pending', false, $2, 0, $3, '', 0, 0, $4, $5)
    `, [id, token, wsId, adminUser.id, Date.now()])
    subIds.push(id)

    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ challenge: 'wrong' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    ))

    const { PATCH } = await import('@/app/api/integrations/events/route')
    const res = await PATCH(asRequest('PATCH', '/api/integrations/events', {
      cookie: adminUser.sessionCookie,
      body: { action: 'verify', subscription_id: id },
    }))

    expect(res.status).toBe(200)
    const data = await res.json() as { verification: string; subscription: { status: string } }
    expect(data.verification).toBe('failed')
    expect(data.subscription.status).toBe('pending')
  })
})

// ── Fan-out respects verified flag ────────────────────────────────────

describe('fanOutEventSubscriptions — verified flag gates delivery', () => {
  it('does not enqueue event_deliver jobs for unverified (pending) subscriptions', async () => {
    // Insert a pending (unverified) subscription
    const id = randomUUID()
    const secret = `whsec_${randomUUID().replace(/-/g, '')}`
    await ctx.pool.query(`
      INSERT INTO aaelink.event_subscriptions
        (id, bot_id, endpoint_url, events, signing_secret, status,
         verified, verification_token, verified_at,
         workspace_id, description, delivery_count, failure_count, created_by, created_at)
      VALUES ($1, NULL, 'https://hook.test/unverified', '["message.created"]',
              $2, 'pending', false, NULL, 0, $3, '', 0, 0, $4, $5)
    `, [id, secret, wsId, adminUser.id, Date.now()])
    subIds.push(id)

    // Post a message to trigger emitWebhookEvent
    const { POST } = await import('@/app/api/messages/route')
    await POST(asRequest('POST', '/api/messages', {
      cookie: adminUser.sessionCookie,
      body: { channel_id: channel.id, message: 'fan-out unverified test' },
    }))

    // No event_deliver job should have been queued for this subscription
    const { rows } = await ctx.pool.query<{ payload: string }>(
      `SELECT payload FROM aaelink.jobs WHERE type = 'event_deliver' AND created_by = $1`, [adminUser.id]
    )
    const matchingJobs = rows
      .map(r => { try { return JSON.parse(r.payload) as { subscription_id?: string } } catch { return null } })
      .filter(p => p?.subscription_id === id)
    expect(matchingJobs).toHaveLength(0)
  })

  it('enqueues event_deliver jobs for verified (active) subscriptions', async () => {
    // Insert a verified active subscription
    const id = randomUUID()
    const secret = `whsec_${randomUUID().replace(/-/g, '')}`
    const now = Date.now()
    await ctx.pool.query(`
      INSERT INTO aaelink.event_subscriptions
        (id, bot_id, endpoint_url, events, signing_secret, status,
         verified, verification_token, verified_at,
         workspace_id, description, delivery_count, failure_count, created_by, created_at)
      VALUES ($1, NULL, 'https://hook.test/verified', '["message.created"]',
              $2, 'active', true, NULL, $3, $4, '', 0, 0, $5, $3)
    `, [id, secret, now, wsId, adminUser.id])
    subIds.push(id)

    const { POST } = await import('@/app/api/messages/route')
    await POST(asRequest('POST', '/api/messages', {
      cookie: adminUser.sessionCookie,
      body: { channel_id: channel.id, message: 'fan-out verified test' },
    }))

    const { rows } = await ctx.pool.query<{ payload: string }>(
      `SELECT payload FROM aaelink.jobs WHERE type = 'event_deliver' AND created_by = $1`, [adminUser.id]
    )
    const matchingJobs = rows
      .map(r => { try { return JSON.parse(r.payload) as { subscription_id?: string } } catch { return null } })
      .filter(p => p?.subscription_id === id)
    expect(matchingJobs.length).toBeGreaterThan(0)
  })
})
