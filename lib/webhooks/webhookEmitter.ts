/**
 * Webhook Event Emitter
 *
 * Utility that any API route can call to fire webhook events.
 * Automatically finds all v2 webhook subscriptions for the event type,
 * and queues deliveries via the job system.
 *
 * Usage:
 *   import { emitWebhookEvent } from '@/lib/webhooks/webhookEmitter'
 *
 *   // In a message creation handler:
 *   await emitWebhookEvent(pool, 'message.created', {
 *     channel_id: channelId,
 *     message_id: messageId,
 *     user_id: userId,
 *     content: messageContent,
 *   }, userId)
 */

import type { Pool } from 'pg'
import { randomUUID, createHmac } from 'crypto'
import { claimEventDelivery } from '@/lib/events/eventDedup'

/** All supported webhook event types */
export const WEBHOOK_EVENT_TYPES = [
  'message.created', 'message.updated', 'message.deleted',
  'channel.created', 'channel.archived', 'channel.member_joined', 'channel.member_left',
  'user.created', 'user.updated', 'user.deactivated',
  'reaction.added', 'reaction.removed',
  'file.uploaded', 'file.deleted',
  'call.started', 'call.ended',
  'compliance.dlp_violation', 'compliance.legal_hold_created',
] as const

export type WebhookEventType = typeof WEBHOOK_EVENT_TYPES[number]

/**
 * Event names accepted by emitWebhookEvent. The webhooks_v2 system uses the
 * curated WEBHOOK_EVENT_TYPES list, while the event_subscriptions (Events API)
 * system supports a partly-overlapping superset (e.g. 'channel.renamed',
 * 'member.joined'). Accept any string but keep autocomplete for the known set.
 */
export type EmittableEventType = WebhookEventType | (string & {})

function signPayload(payload: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(payload, 'utf8').digest('hex')}`
}

/**
 * Emit a webhook event to all subscribed v2 webhooks.
 *
 * This queues delivery jobs rather than sending synchronously,
 * so it returns immediately and doesn't block the API response.
 *
 * @param pool - Database pool
 * @param eventType - The event type (e.g. 'message.created')
 * @param data - Event payload data
 * @param actorId - User who triggered the event (for audit)
 * @param channelId - Optional channel scope (only deliver to webhooks scoped to this channel)
 * @param workspaceId - Optional workspace scope for Events-API subscriptions. When
 *   omitted but a channelId is supplied, it is resolved from the channel's home
 *   workspace so a single shared-channel emit (D1) maps to one workspace and
 *   workspace-scoped subscriptions in OTHER workspaces never fire.
 */
export async function emitWebhookEvent(
  pool: Pool,
  eventType: EmittableEventType,
  data: Record<string, unknown>,
  actorId: string,
  channelId?: string,
  workspaceId?: string,
  opts?: { createdBy?: string | null }
): Promise<{ queued: number; webhooks_v2: number; event_subscriptions: number }> {
  // The job's created_by FK references aaelink.users(id). Most callers pass a real
  // user as actorId, but app-originated emits (e.g. interactivity ingress) have a
  // bot/app actor that is NOT a users row — they pass opts.createdBy:null so the
  // nullable FK column is left empty while actorId still rides the event envelope.
  const jobCreatedBy = opts && 'createdBy' in opts ? (opts.createdBy ?? null) : actorId

  // Find all active webhooks subscribed to this event type
  const { rows: webhooks } = await pool.query<{
    id: string; url: string; secret: string; events: string; channel_id: string
  }>(`
    SELECT id, url, secret, events, channel_id
    FROM aaelink.webhooks_v2
    WHERE is_active = true
  `)

  const now = Date.now()
  let webhooksV2Queued = 0

  for (const wh of webhooks) {
    // Check event filter
    let allowedEvents: string[] = []
    try { allowedEvents = JSON.parse(wh.events || '[]') } catch { /**/ }
    if (allowedEvents.length > 0 && !allowedEvents.includes(eventType)) continue

    // Check channel scope
    if (wh.channel_id && channelId && wh.channel_id !== channelId) continue

    // Build payload
    const payload = JSON.stringify({
      event: eventType,
      timestamp: new Date(now).toISOString(),
      data,
      actor_id: actorId,
    })

    const signature = signPayload(payload, wh.secret)
    const deliveryId = randomUUID()

    // Queue delivery via job system (non-blocking)
    await pool.query(`
      INSERT INTO aaelink.jobs
        (id, type, status, priority, payload, run_after, max_retries, attempts, created_by, created_at)
      VALUES ($1, 'webhook_deliver', 'pending', 3, $2, $3, 6, 0, $4, $3)
    `, [randomUUID(), JSON.stringify({
      delivery_id: deliveryId,
      webhook_id: wh.id,
      url: wh.url,
      event_type: eventType,
      payload,
      signature,
    }), now, jobCreatedBy])

    // Also log delivery record
    await pool.query(`
      INSERT INTO aaelink.webhook_deliveries_v2
        (id, webhook_id, event_type, status, status_code, attempts, next_retry_at,
         request_body, response_body, latency_ms, error_message, created_at)
      VALUES ($1, $2, $3, 'queued', 0, 0, 0, $4, '', 0, '', $5)
    `, [deliveryId, wh.id, eventType, payload, now])

    webhooksV2Queued++
  }

  // ── Events API fan-out: aaelink.event_subscriptions ─────────────────
  // The Events API (app/api/integrations/events) registers external endpoints
  // that until now had ZERO production dispatch. Fan out the SAME JSON envelope
  // here so registered subscriptions actually receive events. Non-blocking:
  // each delivery is a queued 'event_deliver' job, mirroring webhooks_v2.
  //
  // Resolve the event's home workspace from the channel (when not passed) so the
  // fan-out can scope workspace-bound subscriptions and dedup shared-channel
  // re-emits. A failure here must not break the request, so it is best-effort.
  let resolvedWs = workspaceId
  if (!resolvedWs && channelId) {
    try {
      const { rows } = await pool.query<{ workspace_id: string | null }>(
        `SELECT workspace_id FROM aaelink.channels WHERE id = $1`, [channelId]
      )
      resolvedWs = rows[0]?.workspace_id ?? undefined
    } catch { /* best-effort: fall back to global-only subscriptions */ }
  }
  const eventSubsQueued = await fanOutEventSubscriptions(
    pool, eventType, data, actorId, now, { channelId, workspaceId: resolvedWs, createdBy: jobCreatedBy }
  )

  return {
    queued: webhooksV2Queued + eventSubsQueued,
    webhooks_v2: webhooksV2Queued,
    event_subscriptions: eventSubsQueued,
  }
}

/**
 * Fan an event out to all active Events-API subscriptions whose `events` filter
 * matches the event type (exact or '*' wildcard). Each match is enqueued as an
 * 'event_deliver' job carrying the same envelope + an HMAC-SHA256 signature
 * computed with that subscription's own signing_secret. Returns the queued count.
 *
 * Workspace scoping (D1 shared channels): the SELECT only returns GLOBAL
 * subscriptions (workspace_id NULL/empty) plus subscriptions bound to the event's
 * own workspace. A workspace-scoped subscription therefore never fires for events
 * in a different workspace. When the workspace can't be resolved, only global
 * subscriptions fire (a workspace-scoped sub is never delivered an event of
 * unknown provenance).
 *
 * Deduplication (at-most-once per logical event): a single logical message in a
 * shared channel can drive emitWebhookEvent once per sharing workspace. Before
 * enqueuing, we claimEventDelivery per (subscription, event_type, channel, ts);
 * a re-emit's claim is a no-op so the subscriber receives exactly one copy.
 *
 * Performance: matched rows are collected and inserted in a SINGLE multi-VALUES
 * INSERT (O(1) round-trips), not one INSERT per subscription, so the hot message
 * path stays O(1) regardless of subscription count.
 *
 * Note: aaelink.event_deliveries is the dedup-CLAIM table (PK = dedup_key), owned
 * by lib/events/eventDedup.ts — NOT a per-attempt delivery log. Subscription-level
 * stats live on event_subscriptions itself (delivery_count / failure_count /
 * last_delivery_at), updated by the worker.
 */
async function fanOutEventSubscriptions(
  pool: Pool,
  eventType: EmittableEventType,
  data: Record<string, unknown>,
  actorId: string,
  now: number,
  scope: { channelId?: string; workspaceId?: string; createdBy?: string | null } = {}
): Promise<number> {
  const { channelId, workspaceId } = scope
  // created_by for the queued jobs (nullable users FK). Defaults to actorId for
  // backwards-compat; app-originated emits pass null (bot actor is not a user).
  const jobCreatedBy = 'createdBy' in scope ? (scope.createdBy ?? null) : actorId
  // Scope by workspace: global subs (NULL/empty workspace_id) always match;
  // workspace-bound subs match only when their workspace equals the event's.
  // `events` is stored as JSONB; pg returns it already-parsed as a JS array.
  const { rows: subs } = await pool.query<{
    id: string; endpoint_url: string; events: unknown; signing_secret: string
  }>(`
    SELECT id, endpoint_url, events, signing_secret
    FROM aaelink.event_subscriptions
    WHERE status = 'active'
      AND verified = true
      AND (workspace_id IS NULL OR workspace_id = '' OR workspace_id = $1)
  `, [workspaceId ?? ''])

  // Channel key used for dedup. Falls back to '' so a no-channel event still
  // dedups stably per (subscription, event_type, ts).
  const channelKey = channelId ?? ''

  // Collect the rows for one batched INSERT instead of N serial round-trips.
  const valueTuples: string[] = []
  const params: unknown[] = []
  let queued = 0

  for (const sub of subs) {
    const allowedEvents: string[] = Array.isArray(sub.events)
      ? (sub.events as string[])
      : (() => { try { return JSON.parse(String(sub.events ?? '[]')) } catch { return [] } })()

    if (!allowedEvents.includes('*') && !allowedEvents.includes(eventType)) continue
    if (!sub.endpoint_url || !sub.signing_secret) continue

    // At-most-once per logical event: skip if this (subscription, event, channel,
    // ts) was already claimed by a sibling re-emit (e.g. shared-channel fan-in).
    const claimed = await claimEventDelivery(
      pool,
      { subscriptionId: sub.id, eventType: String(eventType), channelKey, eventTs: now },
      now
    )
    if (!claimed) continue

    const payload = JSON.stringify({
      event: eventType,
      timestamp: new Date(now).toISOString(),
      data,
      actor_id: actorId,
    })
    const signature = signPayload(payload, sub.signing_secret)
    const jobPayload = JSON.stringify({
      delivery_id: randomUUID(),
      subscription_id: sub.id,
      endpoint_url: sub.endpoint_url,
      event_type: eventType,
      payload,
      signature,
    })

    // Build one VALUES tuple. Column order:
    // (id, type, status, priority, payload, run_after, max_retries, attempts, created_by, created_at)
    const base = params.length
    valueTuples.push(
      `($${base + 1}, 'event_deliver', 'pending', 3, $${base + 2}, $${base + 3}, 6, 0, $${base + 4}, $${base + 3})`
    )
    params.push(randomUUID(), jobPayload, now, jobCreatedBy)
    queued++
  }

  if (valueTuples.length > 0) {
    await pool.query(`
      INSERT INTO aaelink.jobs
        (id, type, status, priority, payload, run_after, max_retries, attempts, created_by, created_at)
      VALUES ${valueTuples.join(', ')}
    `, params)
  }

  return queued
}

/**
 * Convenience function to emit a message event.
 */
export function emitMessageCreated(
  pool: Pool,
  data: { channel_id: string; message_id: string; user_id: string; content?: string }
) {
  return emitWebhookEvent(pool, 'message.created', data, data.user_id, data.channel_id)
}

export function emitMessageDeleted(
  pool: Pool,
  data: { channel_id: string; message_id: string; user_id: string }
) {
  return emitWebhookEvent(pool, 'message.deleted', data, data.user_id, data.channel_id)
}

export function emitChannelCreated(
  pool: Pool,
  data: { channel_id: string; name: string; type: string; user_id: string }
) {
  return emitWebhookEvent(pool, 'channel.created', data, data.user_id)
}

export function emitUserCreated(
  pool: Pool,
  data: { user_id: string; email: string; role: string; created_by: string }
) {
  return emitWebhookEvent(pool, 'user.created', data, data.created_by)
}

export function emitFileUploaded(
  pool: Pool,
  data: { file_id: string; filename: string; size: number; user_id: string; channel_id?: string }
) {
  return emitWebhookEvent(pool, 'file.uploaded', data, data.user_id, data.channel_id)
}

export function emitDlpViolation(
  pool: Pool,
  data: { rule_id: string; rule_name: string; message_id?: string; user_id: string; severity: string }
) {
  return emitWebhookEvent(pool, 'compliance.dlp_violation', data, data.user_id)
}
