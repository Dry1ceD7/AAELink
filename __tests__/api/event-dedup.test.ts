/**
 * Integration + unit tests for D7 Events API dedup.
 *
 * eventMatches / dedupKey are pure; claimEventDelivery runs against a live
 * Postgres. Covers the Grid hazard: the same event re-emitted per sharing
 * workspace is delivered once.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { createTestContext, TestContext } from '../helpers'
import { eventMatches, dedupKey, claimEventDelivery } from '@/lib/events/eventDedup'

let ctx: TestContext
const subIds: string[] = []

function newSub(): string {
  const id = `sub-${randomUUID().slice(0, 10)}`
  subIds.push(id)
  return id
}

beforeAll(async () => { ctx = await createTestContext() })

afterAll(async () => {
  if (subIds.length) await ctx.pool.query(`DELETE FROM aaelink.event_deliveries WHERE subscription_id = ANY($1)`, [subIds])
})

describe('eventMatches', () => {
  it('matches exact and wildcard, rejects others', () => {
    expect(eventMatches(['message.created'], 'message.created')).toBe(true)
    expect(eventMatches(['*'], 'anything.happened')).toBe(true)
    expect(eventMatches(['reaction.added'], 'message.created')).toBe(false)
    expect(eventMatches([], 'message.created')).toBe(false)
  })
})

describe('dedupKey', () => {
  it('is stable for the same logical event', () => {
    const a = dedupKey({ subscriptionId: 's1', eventType: 'message.created', channelKey: 'C1', eventTs: 1700 })
    const b = dedupKey({ subscriptionId: 's1', eventType: 'message.created', channelKey: 'C1', eventTs: 1700 })
    expect(a).toBe(b)
    const c = dedupKey({ subscriptionId: 's1', eventType: 'message.created', channelKey: 'C2', eventTs: 1700 })
    expect(c).not.toBe(a)
  })
})

describe('claimEventDelivery', () => {
  it('claims once and dedupes re-emits (Grid: per-sharing-workspace)', async () => {
    const sub = newSub()
    const evt = { subscriptionId: sub, eventType: 'message.created', channelKey: 'C1', eventTs: 1700 }

    expect(await claimEventDelivery(ctx.pool, evt)).toBe(true)   // first delivery
    expect(await claimEventDelivery(ctx.pool, evt)).toBe(false)  // re-emit from another sharing workspace
    expect(await claimEventDelivery(ctx.pool, evt)).toBe(false)  // and again
  })

  it('delivers independently to different subscriptions', async () => {
    const subA = newSub()
    const subB = newSub()
    const base = { eventType: 'reaction.added', channelKey: 'C9', eventTs: 2000 }
    expect(await claimEventDelivery(ctx.pool, { ...base, subscriptionId: subA })).toBe(true)
    expect(await claimEventDelivery(ctx.pool, { ...base, subscriptionId: subB })).toBe(true)
    expect(await claimEventDelivery(ctx.pool, { ...base, subscriptionId: subA })).toBe(false)
  })

  it('treats a different timestamp as a distinct event', async () => {
    const sub = newSub()
    expect(await claimEventDelivery(ctx.pool, { subscriptionId: sub, eventType: 'message.created', channelKey: 'C1', eventTs: 100 })).toBe(true)
    expect(await claimEventDelivery(ctx.pool, { subscriptionId: sub, eventType: 'message.created', channelKey: 'C1', eventTs: 200 })).toBe(true)
  })
})
