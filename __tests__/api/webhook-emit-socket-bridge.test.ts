/**
 * Unit test: fanOutEventSubscriptions socket-mode bridge
 * (Integrations parity §25 — Task 2).
 *
 * fanOutEventSubscriptions (inside emitWebhookEvent) was extended to call
 * publishAppEvent(pubsub, botId, envelope) for every matched active subscription
 * that has a non-null bot_id, alongside the queued HTTP event_deliver job. This
 * pins that bridge so that removing the publishAppEvent call in
 * webhookEmitter.ts causes these assertions to fail.
 *
 * The test uses a fake Pool (no live DB required). getPubSub is mocked via
 * vi.mock so the module-level singleton is replaced with a capturing spy
 * without hitting the ES-module read-only export restriction.
 * Mirror style from tests/socketMode.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomUUID } from 'crypto'
import type { Pool } from 'pg'
import { MemoryPubSub } from '@/lib/realtime/redisPubSub'
import { appEventTopic } from '@/lib/apps/socketMode'

// ── Mock getPubSub so webhookEmitter picks up our spy ─────────────────────
// vi.mock is hoisted above imports by Vitest, so the mock is in place before
// webhookEmitter.ts is evaluated and caches the adapter.
// We expose a single mutable `spyPubsub` variable that each test can swap.

let spyPubsub: MemoryPubSub = new MemoryPubSub()

vi.mock('@/lib/realtime/redisPubSub', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/realtime/redisPubSub')>()
  return {
    ...original,
    getPubSub: () => spyPubsub,
  }
})

// Import AFTER the mock is registered (Vitest hoists vi.mock above imports).
import { emitWebhookEvent } from '@/lib/webhooks/webhookEmitter'

// ── Captured pub/sub messages ─────────────────────────────────────────────

interface CapturedPublish {
  topic: string
  payload: unknown
}

/** Wrap a MemoryPubSub to capture every publish call. */
function makeSpy(): { pubsub: MemoryPubSub; captured: CapturedPublish[] } {
  const pubsub = new MemoryPubSub()
  const captured: CapturedPublish[] = []
  const origPublish = pubsub.publish.bind(pubsub)
  pubsub.publish = async (topic: string, event: unknown) => {
    captured.push({ topic, payload: event })
    return origPublish(topic, event as Parameters<typeof origPublish>[1])
  }
  return { pubsub, captured }
}

// ── Fake pool ──────────────────────────────────────────────────────────────
//
// fanOutEventSubscriptions issues (in order):
//   1. SELECT from aaelink.event_subscriptions
//   2. INSERT INTO aaelink.event_deliveries  (claimEventDelivery dedup)
//   3. INSERT INTO aaelink.jobs              (batched delivery jobs)
//
// emitWebhookEvent also queries:
//   4. SELECT from aaelink.webhooks_v2       (returns empty — irrelevant here)
//   5. SELECT workspace_id from aaelink.channels (optional workspace resolve)

interface FakeSubscription {
  id: string
  bot_id: string | null
  endpoint_url: string
  events: string[]
  signing_secret: string
}

function makeFakePool(subs: FakeSubscription[]): Pool {
  const query = async (sql: string, _params: unknown[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim()
    if (s.includes('aaelink.webhooks_v2')) return { rows: [], rowCount: 0 }
    if (s.includes('FROM aaelink.channels')) return { rows: [], rowCount: 0 }
    if (s.includes('FROM aaelink.event_subscriptions')) {
      return {
        rows: subs.map(sub => ({
          id: sub.id,
          endpoint_url: sub.endpoint_url,
          events: sub.events,
          signing_secret: sub.signing_secret,
          bot_id: sub.bot_id,
        })),
        rowCount: subs.length,
      }
    }
    // claimEventDelivery — INSERT INTO aaelink.event_deliveries; return claimed.
    if (s.includes('aaelink.event_deliveries')) return { rows: [], rowCount: 1 }
    // Batched jobs INSERT.
    if (s.includes('aaelink.jobs')) return { rows: [], rowCount: 1 }
    return { rows: [], rowCount: 0 }
  }
  return { query } as unknown as Pool
}

// ── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Fresh spy for every test so captured arrays don't bleed.
  const { pubsub } = makeSpy()
  spyPubsub = pubsub
})

describe('fanOutEventSubscriptions — socket-mode bridge (publishAppEvent)', () => {
  it('publishes to the matching bot topic when the subscription has a bot_id', async () => {
    const botId = `bot-${randomUUID().slice(0, 8)}`
    const captured: CapturedPublish[] = []
    const origPublish = spyPubsub.publish.bind(spyPubsub)
    spyPubsub.publish = async (topic: string, event: unknown) => {
      captured.push({ topic, payload: event })
      return origPublish(topic, event as Parameters<typeof origPublish>[1])
    }

    const subs: FakeSubscription[] = [{
      id: randomUUID(), bot_id: botId,
      endpoint_url: 'https://example.test/events',
      events: ['message.created'], signing_secret: 'sec_abc',
    }]
    const pool = makeFakePool(subs)

    await emitWebhookEvent(pool, 'message.created', { message_id: 'm1' }, 'user-1')

    const botTopic = appEventTopic(botId)
    const delivered = captured.filter(c => c.topic === botTopic)
    expect(delivered).toHaveLength(1)
    const pl = (delivered[0].payload as { payload?: { event_type?: string } })?.payload
    expect(pl?.event_type).toBe('message.created')
  })

  it('does NOT publish to a different bot topic when that bot has no matching subscription', async () => {
    const botA = `bot-${randomUUID().slice(0, 8)}`
    const botB = `bot-${randomUUID().slice(0, 8)}`
    const captured: CapturedPublish[] = []
    const origPublish = spyPubsub.publish.bind(spyPubsub)
    spyPubsub.publish = async (topic: string, event: unknown) => {
      captured.push({ topic, payload: event })
      return origPublish(topic, event as Parameters<typeof origPublish>[1])
    }

    const subs: FakeSubscription[] = [{
      id: randomUUID(), bot_id: botA,
      endpoint_url: 'https://example.test/a',
      events: ['message.created'], signing_secret: 'sec_a',
    }]
    const pool = makeFakePool(subs)

    await emitWebhookEvent(pool, 'message.created', { message_id: 'm2' }, 'user-1')

    expect(captured.filter(c => c.topic === appEventTopic(botA))).toHaveLength(1)
    expect(captured.filter(c => c.topic === appEventTopic(botB))).toHaveLength(0)
  })

  it('publishes to multiple bot topics when multiple subscriptions match', async () => {
    const botX = `bot-${randomUUID().slice(0, 8)}`
    const botY = `bot-${randomUUID().slice(0, 8)}`
    const captured: CapturedPublish[] = []
    const origPublish = spyPubsub.publish.bind(spyPubsub)
    spyPubsub.publish = async (topic: string, event: unknown) => {
      captured.push({ topic, payload: event })
      return origPublish(topic, event as Parameters<typeof origPublish>[1])
    }

    const subs: FakeSubscription[] = [
      { id: randomUUID(), bot_id: botX, endpoint_url: 'https://example.test/x', events: ['channel.created'], signing_secret: 'sec_x' },
      { id: randomUUID(), bot_id: botY, endpoint_url: 'https://example.test/y', events: ['channel.created'], signing_secret: 'sec_y' },
    ]
    const pool = makeFakePool(subs)

    await emitWebhookEvent(pool, 'channel.created', { channel_id: 'ch1' }, 'user-1')

    expect(captured.filter(c => c.topic === appEventTopic(botX))).toHaveLength(1)
    expect(captured.filter(c => c.topic === appEventTopic(botY))).toHaveLength(1)
  })

  it('does NOT publish when the subscription has no bot_id (HTTP-only subscription)', async () => {
    const captured: CapturedPublish[] = []
    const origPublish = spyPubsub.publish.bind(spyPubsub)
    spyPubsub.publish = async (topic: string, event: unknown) => {
      captured.push({ topic, payload: event })
      return origPublish(topic, event as Parameters<typeof origPublish>[1])
    }

    const subs: FakeSubscription[] = [{
      id: randomUUID(), bot_id: null,
      endpoint_url: 'https://example.test/http-only',
      events: ['message.created'], signing_secret: 'sec_http',
    }]
    const pool = makeFakePool(subs)

    await emitWebhookEvent(pool, 'message.created', { message_id: 'm3' }, 'user-1')

    const appTopics = captured.filter(c => c.topic.startsWith('app:'))
    expect(appTopics).toHaveLength(0)
  })

  it('does NOT publish when the event type does not match the subscription filter', async () => {
    const botId = `bot-${randomUUID().slice(0, 8)}`
    const captured: CapturedPublish[] = []
    const origPublish = spyPubsub.publish.bind(spyPubsub)
    spyPubsub.publish = async (topic: string, event: unknown) => {
      captured.push({ topic, payload: event })
      return origPublish(topic, event as Parameters<typeof origPublish>[1])
    }

    const subs: FakeSubscription[] = [{
      id: randomUUID(), bot_id: botId,
      endpoint_url: 'https://example.test/filtered',
      events: ['channel.created'], signing_secret: 'sec_filt',
    }]
    const pool = makeFakePool(subs)

    await emitWebhookEvent(pool, 'message.created', { message_id: 'm4' }, 'user-1')

    expect(captured.filter(c => c.topic === appEventTopic(botId))).toHaveLength(0)
  })
})
