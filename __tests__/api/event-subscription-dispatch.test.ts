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

async function createSub(
  events: string[],
  status = 'active',
  opts: { workspaceId?: string | null } = {}
): Promise<{ id: string; secret: string; url: string }> {
  const id = randomUUID()
  const secret = `whsec_${randomUUID().replace(/-/g, '')}`
  const url = `https://hook.test/${id.slice(0, 8)}`
  // Default to the channel's workspace; callers can bind to another workspace or
  // pass null for a GLOBAL (all-workspaces) subscription.
  const subWs = 'workspaceId' in opts ? opts.workspaceId : wsId
  await ctx.pool.query(`
    INSERT INTO aaelink.event_subscriptions
      (id, bot_id, endpoint_url, events, signing_secret, status,
       workspace_id, description, delivery_count, failure_count, created_by, created_at)
    VALUES ($1, NULL, $2, $3, $4, $5, $6, '', 0, 0, $7, $8)
  `, [id, url, JSON.stringify(events), secret, status, subWs, user.id, Date.now()])
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
