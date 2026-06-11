/**
 * Events API dispatch wiring — emitWebhookEvent now fans events out to BOTH the
 * webhooks_v2 system AND aaelink.event_subscriptions (the Events API), which had
 * zero production dispatch before this change.
 *
 * Pure-unit test: a fake pg Pool intercepts the two SELECTs (webhooks_v2 +
 * event_subscriptions) and records every INSERT INTO aaelink.jobs so we can
 * assert which 'event_deliver' jobs get queued, with a valid per-subscription
 * HMAC-SHA256 signature, while leaving webhooks_v2 behaviour untouched.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHmac } from 'crypto'
import { emitWebhookEvent } from '@/lib/webhooks/webhookEmitter'

interface SubRow {
  id: string; endpoint_url: string; events: unknown; signing_secret: string
}
interface WebhookRow {
  id: string; url: string; secret: string; events: string; channel_id: string
}
interface JobInsert { sql: string; args: unknown[] }

function sign(payload: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(payload, 'utf8').digest('hex')}`
}

/**
 * Build a fake pool whose SELECTs return the supplied webhooks_v2 + subscription
 * rows, swallows the webhook_deliveries_v2 / event_subscriptions UPDATE inserts,
 * and captures every job insert for assertions.
 *
 * Also models two queries the fan-out now issues:
 *  - the channel→workspace lookup (returns opts.channelWorkspaceId)
 *  - the event_deliveries dedup CLAIM insert (INSERT ... ON CONFLICT DO NOTHING),
 *    which must report rowCount=1 on first claim so the fan-out proceeds. A
 *    repeated dedup_key reports rowCount=0 (the claim was a no-op) so a re-emit
 *    is skipped — exactly the shared-channel dedup contract.
 */
function makePool(opts: { webhooks?: WebhookRow[]; subs?: SubRow[]; channelWorkspaceId?: string | null } = {}) {
  const jobInserts: JobInsert[] = []
  const claimedKeys = new Set<string>()
  const pool = {
    query: async (sql: string, args?: unknown[]) => {
      if (sql.includes('FROM aaelink.webhooks_v2')) {
        return { rows: opts.webhooks ?? [] }
      }
      if (sql.includes('FROM aaelink.channels')) {
        return { rows: 'channelWorkspaceId' in opts ? [{ workspace_id: opts.channelWorkspaceId ?? null }] : [] }
      }
      if (sql.includes('FROM aaelink.event_subscriptions')) {
        return { rows: opts.subs ?? [] }
      }
      if (sql.includes('INSERT INTO aaelink.event_deliveries')) {
        // First arg is the dedup_key; mimic ON CONFLICT DO NOTHING.
        const key = String((args ?? [])[0])
        if (claimedKeys.has(key)) return { rows: [], rowCount: 0 }
        claimedKeys.add(key)
        return { rows: [], rowCount: 1 }
      }
      if (sql.includes('INSERT INTO aaelink.jobs')) {
        jobInserts.push({ sql, args: args ?? [] })
        return { rows: [] }
      }
      // webhook_deliveries_v2 log insert and anything else
      return { rows: [] }
    },
  }
  return { pool, jobInserts }
}

/**
 * Pull the parsed payload of every job insert of a given type. webhooks_v2 jobs
 * are inserted one-per-statement (payload at args[1]); event_deliver jobs are now
 * inserted in a SINGLE batched multi-VALUES statement, so their payloads sit at
 * several positions. Scan every arg, parse JSON objects, and keep those matching
 * the requested job shape.
 */
function jobsOfType(jobInserts: JobInsert[], type: string) {
  const out: Record<string, unknown>[] = []
  for (const j of jobInserts) {
    for (const arg of j.args) {
      if (typeof arg !== 'string') continue
      let p: Record<string, unknown> | null = null
      try { p = JSON.parse(arg) as Record<string, unknown> } catch { p = null }
      if (!p || typeof p !== 'object') continue
      // discriminate by shape: event_deliver carries subscription_id/endpoint_url
      if (type === 'event_deliver' && 'subscription_id' in p && 'endpoint_url' in p) out.push(p)
      else if (type === 'webhook_deliver' && 'webhook_id' in p && 'url' in p) out.push(p)
    }
  }
  return out
}

describe('emitWebhookEvent — Events API (event_subscriptions) dispatch', () => {
  let inserts: JobInsert[]
  // typed as the structural subset emitWebhookEvent needs
  let pool: Parameters<typeof emitWebhookEvent>[0]

  beforeEach(() => {
    inserts = []
  })

  it('queues an event_deliver job with a valid signature for an active matching subscription', async () => {
    const sub: SubRow = {
      id: 'sub-1',
      endpoint_url: 'https://hook.test/events',
      events: ['message.created', 'reaction.added'],
      signing_secret: 'whsec_abc',
    }
    const made = makePool({ subs: [sub] })
    pool = made.pool as unknown as Parameters<typeof emitWebhookEvent>[0]
    inserts = made.jobInserts

    const result = await emitWebhookEvent(
      pool, 'message.created', { channel_id: 'c1', message_id: 'm1', user_id: 'u1' }, 'u1', 'c1'
    )

    const evJobs = jobsOfType(inserts, 'event_deliver')
    expect(evJobs).toHaveLength(1)
    const job = evJobs[0]
    expect(job.subscription_id).toBe('sub-1')
    expect(job.endpoint_url).toBe('https://hook.test/events')
    expect(job.event_type).toBe('message.created')

    // Signature must verify against the subscription's own signing_secret over
    // the exact payload envelope carried in the job.
    expect(job.signature).toBe(sign(String(job.payload), sub.signing_secret))

    // Envelope shape mirrors webhooks_v2.
    const envelope = JSON.parse(String(job.payload)) as Record<string, unknown>
    expect(envelope).toMatchObject({
      event: 'message.created',
      actor_id: 'u1',
      data: { channel_id: 'c1', message_id: 'm1', user_id: 'u1' },
    })

    expect(result.event_subscriptions).toBe(1)
    expect(result.queued).toBe(1)
  })

  it('filters out a subscription whose events list does not include the type', async () => {
    const sub: SubRow = {
      id: 'sub-2',
      endpoint_url: 'https://hook.test/events',
      events: ['ticket.created'],
      signing_secret: 'whsec_x',
    }
    const made = makePool({ subs: [sub] })
    pool = made.pool as unknown as Parameters<typeof emitWebhookEvent>[0]

    const result = await emitWebhookEvent(
      pool, 'message.created', { channel_id: 'c1' }, 'u1', 'c1'
    )

    expect(jobsOfType(made.jobInserts, 'event_deliver')).toHaveLength(0)
    expect(result.event_subscriptions).toBe(0)
  })

  it('matches a wildcard "*" subscription for any event type', async () => {
    const sub: SubRow = {
      id: 'sub-3',
      endpoint_url: 'https://hook.test/all',
      events: ['*'],
      signing_secret: 'whsec_wild',
    }
    const made = makePool({ subs: [sub] })
    pool = made.pool as unknown as Parameters<typeof emitWebhookEvent>[0]

    const result = await emitWebhookEvent(
      pool, 'channel.renamed', { channel_id: 'c1', name: 'new' }, 'u1', 'c1'
    )

    const evJobs = jobsOfType(made.jobInserts, 'event_deliver')
    expect(evJobs).toHaveLength(1)
    expect(evJobs[0].event_type).toBe('channel.renamed')
    expect(result.event_subscriptions).toBe(1)
  })

  it('accepts events stored as a JSON string (defensive parse)', async () => {
    const sub: SubRow = {
      id: 'sub-4',
      endpoint_url: 'https://hook.test/str',
      events: JSON.stringify(['message.created']),
      signing_secret: 'whsec_str',
    }
    const made = makePool({ subs: [sub] })
    pool = made.pool as unknown as Parameters<typeof emitWebhookEvent>[0]

    const result = await emitWebhookEvent(pool, 'message.created', { channel_id: 'c1' }, 'u1', 'c1')
    expect(result.event_subscriptions).toBe(1)
  })

  it('skips subscriptions missing endpoint_url or signing_secret', async () => {
    const subs: SubRow[] = [
      { id: 's-a', endpoint_url: '', events: ['*'], signing_secret: 'whsec_a' },
      { id: 's-b', endpoint_url: 'https://hook.test/b', events: ['*'], signing_secret: '' },
    ]
    const made = makePool({ subs })
    pool = made.pool as unknown as Parameters<typeof emitWebhookEvent>[0]

    const result = await emitWebhookEvent(pool, 'message.created', { channel_id: 'c1' }, 'u1', 'c1')
    expect(jobsOfType(made.jobInserts, 'event_deliver')).toHaveLength(0)
    expect(result.event_subscriptions).toBe(0)
  })

  it('leaves webhooks_v2 behaviour unchanged and reports both counts', async () => {
    const wh: WebhookRow = {
      id: 'wh-1',
      url: 'https://hook.test/wh',
      secret: 'shh',
      events: '["message.created"]',
      channel_id: '',
    }
    const sub: SubRow = {
      id: 'sub-5',
      endpoint_url: 'https://hook.test/ev',
      events: ['message.created'],
      signing_secret: 'whsec_both',
    }
    const made = makePool({ webhooks: [wh], subs: [sub] })
    pool = made.pool as unknown as Parameters<typeof emitWebhookEvent>[0]

    const result = await emitWebhookEvent(pool, 'message.created', { channel_id: 'c1' }, 'u1', 'c1')

    const whJobs = jobsOfType(made.jobInserts, 'webhook_deliver')
    const evJobs = jobsOfType(made.jobInserts, 'event_deliver')
    expect(whJobs).toHaveLength(1)
    expect(evJobs).toHaveLength(1)
    // webhooks_v2 job is signed with the webhook secret, NOT the sub secret.
    expect(whJobs[0].signature).toBe(sign(String(whJobs[0].payload), wh.secret))

    expect(result.webhooks_v2).toBe(1)
    expect(result.event_subscriptions).toBe(1)
    expect(result.queued).toBe(2)
  })

  it('queues zero event_deliver jobs when there are no active subscriptions', async () => {
    const made = makePool({ subs: [] })
    pool = made.pool as unknown as Parameters<typeof emitWebhookEvent>[0]
    const result = await emitWebhookEvent(pool, 'message.created', { channel_id: 'c1' }, 'u1', 'c1')
    expect(result.event_subscriptions).toBe(0)
    expect(result.queued).toBe(0)
  })

  it('batches N matching subscriptions into a SINGLE jobs INSERT (O(1) round-trips)', async () => {
    const subs: SubRow[] = Array.from({ length: 5 }, (_, i) => ({
      id: `sub-batch-${i}`,
      endpoint_url: `https://hook.test/${i}`,
      events: ['*'],
      signing_secret: `whsec_${i}`,
    }))
    const made = makePool({ subs })
    pool = made.pool as unknown as Parameters<typeof emitWebhookEvent>[0]

    const result = await emitWebhookEvent(pool, 'message.created', { channel_id: 'c1' }, 'u1', 'c1')

    // All five queued...
    expect(result.event_subscriptions).toBe(5)
    const evJobs = jobsOfType(made.jobInserts, 'event_deliver')
    expect(evJobs).toHaveLength(5)
    expect(new Set(evJobs.map(j => j.subscription_id)).size).toBe(5)

    // ...but via exactly ONE INSERT INTO aaelink.jobs statement (no per-row loop).
    const jobInsertStmts = made.jobInserts.filter(j => j.sql.includes('INSERT INTO aaelink.jobs'))
    expect(jobInsertStmts).toHaveLength(1)
    // The single batched statement carries 5 VALUES tuples.
    expect((jobInsertStmts[0].sql.match(/event_deliver/g) ?? []).length).toBe(5)
  })

  it('dedups a re-emit of the same logical event to the same subscription', async () => {
    const sub: SubRow = {
      id: 'sub-dedup',
      endpoint_url: 'https://hook.test/dedup',
      events: ['message.created'],
      signing_secret: 'whsec_dedup',
    }
    // Reuse one pool (shared claimedKeys set) across both emits to simulate the
    // shared-channel fan-in: same channel + same event fired twice.
    const made = makePool({ subs: [sub] })
    pool = made.pool as unknown as Parameters<typeof emitWebhookEvent>[0]

    // Pin Date.now so both emits share an event timestamp → identical dedup key.
    const fixed = 1_700_000_000_000
    const spy = vi.spyOn(Date, 'now').mockReturnValue(fixed)
    try {
      const first = await emitWebhookEvent(pool, 'message.created', { channel_id: 'shared-c' }, 'u1', 'shared-c')
      const second = await emitWebhookEvent(pool, 'message.created', { channel_id: 'shared-c' }, 'u1', 'shared-c')
      expect(first.event_subscriptions).toBe(1)
      // Second emit is a re-emit of the same logical event → claim is a no-op.
      expect(second.event_subscriptions).toBe(0)
    } finally {
      spy.mockRestore()
    }

    // Only ONE event_deliver job ever queued despite two emits.
    expect(jobsOfType(made.jobInserts, 'event_deliver')).toHaveLength(1)
  })
})
