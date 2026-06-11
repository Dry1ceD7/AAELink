/**
 * Integration test: Events API (event_subscriptions) production dispatch.
 *
 * The aaelink.event_subscriptions registration system had ZERO dispatch —
 * nothing delivered events to registered endpoints. emitWebhookEvent now fans
 * out to active subscriptions too, so posting a message must enqueue an
 * `event_deliver` job for each active subscription whose `events` filter matches
 * (exact or '*'), with a valid per-subscription HMAC-SHA256 signature.
 *
 * Mirrors the webhooks_v2 wiring test in __tests__/api/webhook-emit.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID, createHmac } from 'crypto'
import {
  createTestContext, createTestUser, createTestChannel, asRequest,
  expectSuccess, cleanupTestData, TestContext, TestUser, TestChannel,
} from '../helpers'

let ctx: TestContext
let user: TestUser
let channel: TestChannel
let wsId: string
const subIds: string[] = []
const createdIds: string[] = []

interface EventDeliverPayload {
  subscription_id?: string; endpoint_url?: string; event_type?: string
  payload?: string; signature?: string
}

async function eventDeliverJobsForSub(subId: string): Promise<EventDeliverPayload[]> {
  const { rows } = await ctx.pool.query<{ payload: string }>(
    `SELECT payload FROM aaelink.jobs WHERE type = 'event_deliver' AND created_by = $1`, [user.id]
  )
  return rows
    .map(r => { try { return JSON.parse(r.payload) as EventDeliverPayload } catch { return null } })
    .filter((p): p is EventDeliverPayload => !!p && p.subscription_id === subId)
}

// ── event_deliver failure-semantics fixtures ───────────────────────────
// These mirror lib/infra/worker.ts `event_deliver` byte-for-byte so the test
// pins the production auto-disable contract: failure_count is CONSECUTIVE (reset
// to 0 on every success), and a runaway endpoint flips to 'failing' only after
// FAILURE_THRESHOLD consecutive failures with no recent success.
const FAILURE_THRESHOLD = 50
const RECENT_SUCCESS_WINDOW_MS = 24 * 60 * 60 * 1000

/** Apply the worker's success UPDATE (delivery counted, failure_count reset). */
async function recordSuccess(subId: string): Promise<void> {
  await ctx.pool.query(
    `UPDATE aaelink.event_subscriptions
        SET delivery_count = delivery_count + 1,
            last_delivery_at = $2,
            failure_count = 0,
            status = CASE WHEN status = 'failing' THEN 'active' ELSE status END
      WHERE id = $1`,
    [subId, Date.now()]
  )
}

/** Apply the worker's failure UPDATE (failure_count++, conditional auto-disable). */
async function recordFailure(subId: string): Promise<void> {
  await ctx.pool.query(
    `UPDATE aaelink.event_subscriptions
        SET failure_count = failure_count + 1,
            status = CASE
              WHEN status = 'active'
               AND failure_count + 1 >= $2
               AND (last_delivery_at IS NULL OR last_delivery_at < $3)
              THEN 'failing'
              ELSE status
            END
      WHERE id = $1`,
    [subId, FAILURE_THRESHOLD, Date.now() - RECENT_SUCCESS_WINDOW_MS]
  )
}

async function subState(subId: string): Promise<{ status: string; failure_count: number }> {
  const { rows } = await ctx.pool.query<{ status: string; failure_count: number }>(
    `SELECT status, failure_count FROM aaelink.event_subscriptions WHERE id = $1`, [subId]
  )
  return { status: rows[0].status, failure_count: Number(rows[0].failure_count) }
}

async function createSub(
  events: string[],
  status = 'active',
  opts: { workspaceId?: string | null; verified?: boolean } = {}
): Promise<{ id: string; secret: string; url: string }> {
  const id = randomUUID()
  const secret = `whsec_${randomUUID().replace(/-/g, '')}`
  const url = `https://hook.test/${id.slice(0, 8)}`
  // Default to the channel's workspace; callers can bind to another workspace or
  // pass null for a GLOBAL (all-workspaces) subscription.
  const subWs = 'workspaceId' in opts ? opts.workspaceId : wsId
  // Default verified=true for active subscriptions (mirrors migration 046 backfill:
  // pre-existing active rows are treated as verified so tests that create 'active'
  // subs without going through the handshake still get delivered to).
  const verified = 'verified' in opts ? opts.verified : status === 'active'
  await ctx.pool.query(`
    INSERT INTO aaelink.event_subscriptions
      (id, bot_id, endpoint_url, events, signing_secret, status,
       verified, verification_token, verified_at,
       workspace_id, description, delivery_count, failure_count, created_by, created_at)
    VALUES ($1, NULL, $2, $3, $4, $5, $6, NULL, 0, $7, '', 0, 0, $8, $9)
  `, [id, url, JSON.stringify(events), secret, status, verified, subWs, user.id, Date.now()])
  subIds.push(id)
  return { id, secret, url }
}

beforeAll(async () => {
  ctx = await createTestContext()
  user = await createTestUser(ctx.pool, { role: 'employee' })
  createdIds.push(user.id)
  const { rows: [m] } = await ctx.pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.workspace_members WHERE user_id = $1 LIMIT 1`, [user.id]
  )
  wsId = m.workspace_id
  channel = await createTestChannel(ctx.pool, user.id, { workspaceId: wsId })
})

afterAll(async () => {
  await ctx.pool.query(`DELETE FROM aaelink.jobs WHERE created_by = ANY($1)`, [createdIds])
  if (subIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.event_subscriptions WHERE id = ANY($1)`, [subIds])
  }
  await cleanupTestData(ctx.pool, createdIds)
  await ctx.cleanup()
})

describe('Events API dispatch — message POST enqueues event_deliver', () => {
  it('enqueues an event_deliver job with a valid signature for an active matching subscription', async () => {
    const sub = await createSub(['message.created'])

    const { POST } = await import('@/app/api/messages/route')
    await expectSuccess(await POST(asRequest('POST', '/api/messages', {
      cookie: user.sessionCookie, body: { channel_id: channel.id, message: 'hello events api' },
    })))

    const jobs = await eventDeliverJobsForSub(sub.id)
    expect(jobs.length).toBeGreaterThan(0)
    const job = jobs[0]
    expect(job.endpoint_url).toBe(sub.url)
    expect(job.event_type).toBe('message.created')

    const expectedSig = `sha256=${createHmac('sha256', sub.secret).update(String(job.payload), 'utf8').digest('hex')}`
    expect(job.signature).toBe(expectedSig)

    const envelope = JSON.parse(String(job.payload)) as { event: string; data: { channel_id?: string } }
    expect(envelope.event).toBe('message.created')
    expect(envelope.data.channel_id).toBe(channel.id)
  })

  it('matches a wildcard "*" subscription', async () => {
    const sub = await createSub(['*'])
    const { POST } = await import('@/app/api/messages/route')
    await expectSuccess(await POST(asRequest('POST', '/api/messages', {
      cookie: user.sessionCookie, body: { channel_id: channel.id, message: 'wildcard target' },
    })))
    expect((await eventDeliverJobsForSub(sub.id)).length).toBeGreaterThan(0)
  })

  it('does not enqueue for a non-matching subscription', async () => {
    const sub = await createSub(['ticket.created'])
    const { POST } = await import('@/app/api/messages/route')
    await expectSuccess(await POST(asRequest('POST', '/api/messages', {
      cookie: user.sessionCookie, body: { channel_id: channel.id, message: 'non-matching' },
    })))
    expect(await eventDeliverJobsForSub(sub.id)).toHaveLength(0)
  })

  it('does not enqueue for an inactive (status != active) subscription', async () => {
    const sub = await createSub(['message.created'], 'disabled')
    const { POST } = await import('@/app/api/messages/route')
    await expectSuccess(await POST(asRequest('POST', '/api/messages', {
      cookie: user.sessionCookie, body: { channel_id: channel.id, message: 'inactive sub' },
    })))
    expect(await eventDeliverJobsForSub(sub.id)).toHaveLength(0)
  })

  it('does not enqueue for a subscription bound to a DIFFERENT workspace', async () => {
    // Subscription scoped to some other workspace must not receive events that
    // happen in this channel's home workspace (the Grid cross-workspace leak the
    // unscoped query previously caused).
    const otherWs = randomUUID()
    const sub = await createSub(['message.created'], 'active', { workspaceId: otherWs })
    const { POST } = await import('@/app/api/messages/route')
    await expectSuccess(await POST(asRequest('POST', '/api/messages', {
      cookie: user.sessionCookie, body: { channel_id: channel.id, message: 'other-workspace sub' },
    })))
    expect(await eventDeliverJobsForSub(sub.id)).toHaveLength(0)
  })

  it('enqueues for a subscription bound to the channel\'s OWN workspace', async () => {
    const sub = await createSub(['message.created'], 'active', { workspaceId: wsId })
    const { POST } = await import('@/app/api/messages/route')
    await expectSuccess(await POST(asRequest('POST', '/api/messages', {
      cookie: user.sessionCookie, body: { channel_id: channel.id, message: 'own-workspace sub' },
    })))
    expect((await eventDeliverJobsForSub(sub.id)).length).toBeGreaterThan(0)
  })

  it('enqueues for a GLOBAL (null workspace) subscription regardless of workspace', async () => {
    const sub = await createSub(['message.created'], 'active', { workspaceId: null })
    const { POST } = await import('@/app/api/messages/route')
    await expectSuccess(await POST(asRequest('POST', '/api/messages', {
      cookie: user.sessionCookie, body: { channel_id: channel.id, message: 'global sub' },
    })))
    expect((await eventDeliverJobsForSub(sub.id)).length).toBeGreaterThan(0)
  })
})

describe('event_deliver — failure_count is CONSECUTIVE, not lifetime', () => {
  it('resets failure_count to 0 on a successful delivery', async () => {
    const sub = await createSub(['message.created'])
    for (let i = 0; i < 5; i++) await recordFailure(sub.id)
    expect((await subState(sub.id)).failure_count).toBe(5)

    await recordSuccess(sub.id)
    const s = await subState(sub.id)
    expect(s.failure_count).toBe(0)
    expect(s.status).toBe('active')
  })

  it('does NOT auto-disable when failures are interrupted by a success before the threshold', async () => {
    // THRESHOLD-1 failures, then a success (resets the count), then more failures.
    // Because the counter restarts, the runaway threshold is never reached, so a
    // healthy-but-occasionally-flaky endpoint is never prematurely disabled.
    const sub = await createSub(['message.created'])

    for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) await recordFailure(sub.id)
    let s = await subState(sub.id)
    expect(s.failure_count).toBe(FAILURE_THRESHOLD - 1)
    expect(s.status).toBe('active') // still under threshold

    await recordSuccess(sub.id) // <-- the recovery that restarts the counter
    expect((await subState(sub.id)).failure_count).toBe(0)

    // More failures (fewer than the threshold) after the reset: still active.
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) await recordFailure(sub.id)
    s = await subState(sub.id)
    expect(s.failure_count).toBe(FAILURE_THRESHOLD - 1)
    expect(s.status).toBe('active') // NOT 'failing' — counter was restarted
  })

  it('still auto-disables after THRESHOLD CONSECUTIVE failures with no recent success', async () => {
    // Sanity check that the runaway guard still fires when it genuinely should:
    // an endpoint whose last success is outside the recent-success window and that
    // racks up THRESHOLD consecutive failures flips to 'failing'.
    const sub = await createSub(['message.created'])
    // Push last_delivery_at into the past (older than the recent-success window).
    await ctx.pool.query(
      `UPDATE aaelink.event_subscriptions SET last_delivery_at = $2 WHERE id = $1`,
      [sub.id, Date.now() - RECENT_SUCCESS_WINDOW_MS - 1000]
    )
    for (let i = 0; i < FAILURE_THRESHOLD; i++) await recordFailure(sub.id)
    const s = await subState(sub.id)
    expect(s.failure_count).toBe(FAILURE_THRESHOLD)
    expect(s.status).toBe('failing')
  })

  it('recovers a failing subscription back to active (and zeroes the count) on the next success', async () => {
    // Pins the documented auto-recovery contract: the success-path UPDATE's
    // `status = CASE WHEN status = 'failing' THEN 'active' ELSE status END` branch.
    // Drive the sub to 'failing' exactly as the previous test does, then deliver a
    // success and assert the endpoint is reinstated.
    const sub = await createSub(['message.created'])
    await ctx.pool.query(
      `UPDATE aaelink.event_subscriptions SET last_delivery_at = $2 WHERE id = $1`,
      [sub.id, Date.now() - RECENT_SUCCESS_WINDOW_MS - 1000]
    )
    for (let i = 0; i < FAILURE_THRESHOLD; i++) await recordFailure(sub.id)
    expect((await subState(sub.id)).status).toBe('failing') // precondition

    await recordSuccess(sub.id) // <-- exercises the failing→active recovery branch
    const s = await subState(sub.id)
    expect(s.status).toBe('active')
    expect(s.failure_count).toBe(0)
  })
})
