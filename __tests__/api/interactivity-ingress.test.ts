/**
 * Integration tests for interactivity ingress (Integrations parity §29).
 *
 * Covers: valid signature → dispatched to the event_subscriptions pipeline (an
 * 'event_deliver' job is queued), bad signature → 401, stale timestamp → 401,
 * and no registered app → 404. Signature verification REPLACES session auth, so
 * these requests carry no cookie.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, createTestUser, asRequest, TestContext } from '../helpers'
import { signInteractivity, __resetInteractivityNoncesForTests } from '@/lib/integrations/interactivity'
import { POST as interactivity } from '@/app/api/integrations/interactivity/route'
import { POST as views } from '@/app/api/views/route'

let ctx: TestContext
const subIds: string[] = []
const userIds: string[] = []

async function registerSubscription(opts: { events: string[]; secret: string }): Promise<string> {
  const id = randomUUID()
  await ctx.pool.query(
    `INSERT INTO aaelink.event_subscriptions
       (id, bot_id, endpoint_url, events, signing_secret, status, workspace_id, description,
        delivery_count, failure_count, created_by, created_at, verified, verified_at)
     VALUES ($1, NULL, $2, $3, $4, 'active', NULL, 'test', 0, 0, NULL, $5, true, $5)`,
    [id, 'https://app.example.com/events', JSON.stringify(opts.events), opts.secret, Date.now()]
  )
  subIds.push(id)
  return id
}

function signedRequest(secret: string, payload: object, opts: { ts?: number; badSig?: boolean } = {}) {
  const rawBody = JSON.stringify(payload)
  const ts = opts.ts ?? Date.now()
  const sig = opts.badSig ? 'sha256=deadbeef' : signInteractivity(secret, ts, rawBody)
  // asRequest stringifies options.body; we need the EXACT raw bytes we signed, so
  // build the NextRequest with the same JSON and matching headers.
  return asRequest('POST', '/api/integrations/interactivity', {
    body: payload,
    noAutoCsrf: true,
    headers: {
      'x-aaelink-timestamp': String(ts),
      'x-aaelink-signature-256': sig,
    },
  })
}

beforeAll(async () => { ctx = await createTestContext() })

afterEach(async () => {
  await ctx.pool.query(`DELETE FROM aaelink.jobs WHERE type = 'event_deliver'`)
  __resetInteractivityNoncesForTests()
})

afterAll(async () => {
  await ctx.pool.query(`DELETE FROM aaelink.jobs WHERE type = 'event_deliver'`)
  await ctx.pool.query(`DELETE FROM aaelink.event_deliveries WHERE subscription_id = ANY($1)`, [subIds]).catch(() => {})
  await ctx.pool.query(`DELETE FROM aaelink.event_subscriptions WHERE id = ANY($1)`, [subIds])
  if (userIds.length) {
    await ctx.pool.query(`DELETE FROM aaelink.sessions WHERE user_id = ANY($1)`, [userIds])
    await ctx.pool.query(`DELETE FROM aaelink.workspace_members WHERE user_id = ANY($1)`, [userIds])
    await ctx.pool.query(`DELETE FROM aaelink.users WHERE id = ANY($1)`, [userIds])
  }
})

describe('POST /api/integrations/interactivity', () => {
  it('dispatches a valid signed payload through the events pipeline', async () => {
    const secret = `whsec_${randomUUID().replace(/-/g, '')}`
    const subId = await registerSubscription({ events: ['interaction'], secret })

    const payload = { type: 'block_actions', actions: [{ action_id: 'approve' }] }
    const res = await interactivity(signedRequest(secret, payload) as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.dispatched).toBeGreaterThanOrEqual(1)

    // A delivery job was queued for OUR subscription. Other suites (e.g.
    // scheduled-message delivery → emitMessageCreated) also enqueue
    // event_deliver jobs into the shared table, so filter by subscription_id
    // instead of grabbing rows[0].
    const { rows } = await ctx.pool.query(
      `SELECT payload FROM aaelink.jobs WHERE type = 'event_deliver'`
    )
    const jobPayloads = rows.map(r => JSON.parse(r.payload as string))
    const ours = jobPayloads.filter(p => p.subscription_id === subId)
    expect(ours.length).toBeGreaterThanOrEqual(1)
    expect(ours[0].event_type).toBe('interaction')
  })

  it('rejects a replayed (already-seen) signature with 401', async () => {
    const secret = `whsec_${randomUUID().replace(/-/g, '')}`
    await registerSubscription({ events: ['interaction'], secret })

    // Fix the timestamp so both requests carry the IDENTICAL signature.
    const ts = Date.now()
    const payload = { type: 'block_actions', actions: [{ action_id: 'approve' }] }
    const first = await interactivity(signedRequest(secret, payload, { ts }) as never)
    expect(first.status).toBe(200)

    const replay = await interactivity(signedRequest(secret, payload, { ts }) as never)
    expect(replay.status).toBe(401)
    expect((await replay.json()).error).toBe('replayed_signature')
  })

  it('rejects a bad signature with 401', async () => {
    const secret = `whsec_${randomUUID().replace(/-/g, '')}`
    await registerSubscription({ events: ['interaction'], secret })

    const res = await interactivity(signedRequest(secret, { type: 'block_actions' }, { badSig: true }) as never)
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('invalid_signature')
  })

  it('rejects a stale timestamp with 401', async () => {
    const secret = `whsec_${randomUUID().replace(/-/g, '')}`
    await registerSubscription({ events: ['interaction'], secret })

    const staleTs = Date.now() - 10 * 60_000 // 10 min ago, beyond the 5-min window
    const res = await interactivity(signedRequest(secret, { type: 'block_actions' }, { ts: staleTs }) as never)
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('stale_timestamp')
  })

  it('returns 404 when no app is registered', async () => {
    // No subscriptions registered in this test (afterAll/afterEach keep them out,
    // but other tests in this file register some — guard by deleting first).
    await ctx.pool.query(`DELETE FROM aaelink.event_subscriptions WHERE id = ANY($1)`, [subIds])
    subIds.length = 0

    const secret = `whsec_${randomUUID().replace(/-/g, '')}`
    const res = await interactivity(signedRequest(secret, { type: 'block_actions' }) as never)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('unknown_app')
  })

  it('mints a trigger_id on dispatch that the open path accepts end-to-end', async () => {
    // Register a subscription with a known bot registered in bot_users
    const secret = `whsec_${randomUUID().replace(/-/g, '')}`
    // create a user to act as the interacting user
    const user = await createTestUser(ctx.pool, { role: 'employee' })
    userIds.push(user.id)

    // create a bot owned by this user
    const botId = `B${randomUUID().replace(/-/g, '')}`
    await ctx.pool.query(
      `INSERT INTO aaelink.bot_users (id, name, created_by, created_at) VALUES ($1, 'TriggerBot', $2, $3)`,
      [botId, user.id, Date.now()]
    )

    const subId = await registerSubscription({ events: ['interaction'], secret })
    // patch the subscription to carry our bot_id so the trigger is bot-scoped
    await ctx.pool.query(
      `UPDATE aaelink.event_subscriptions SET bot_id = $1 WHERE id = $2`,
      [botId, subId]
    )

    // dispatch an interaction payload that includes user_id — the ingress mints
    // a trigger_id bound to that user
    const payload = { type: 'block_actions', user_id: user.id, actions: [{ action_id: 'click' }] }
    const dispatchRes = await interactivity(signedRequest(secret, payload) as never)
    expect(dispatchRes.status).toBe(200)
    const dispatchBody = await dispatchRes.json() as { ok: boolean; trigger_id: string | null }
    expect(dispatchBody.ok).toBe(true)
    expect(typeof dispatchBody.trigger_id).toBe('string')
    expect(dispatchBody.trigger_id).toMatch(/^Vt/)

    const trigger_id = dispatchBody.trigger_id as string

    // now use that trigger_id to open a modal — proves the minted trigger is valid
    const openRes = await views(asRequest('POST', '/api/views', {
      cookie: user.sessionCookie,
      body: {
        action: 'open',
        bot_id: botId,
        trigger_id,
        view: {
          type: 'modal',
          title: { type: 'plain_text', text: 'From trigger' },
          blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'it works' } }],
        },
      },
    }))
    expect(openRes.status).toBe(200)
    const openBody = await openRes.json() as { ok: boolean; view: { id: string; type: string } }
    expect(openBody.ok).toBe(true)
    expect(openBody.view.type).toBe('modal')

    // cleanup bot
    await ctx.pool.query(`DELETE FROM aaelink.bot_users WHERE id = $1`, [botId])
  })
})
