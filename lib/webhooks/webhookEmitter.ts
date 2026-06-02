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

import { Pool } from 'pg'
import { randomUUID, createHmac } from 'crypto'

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
 */
export async function emitWebhookEvent(
  pool: Pool,
  eventType: WebhookEventType,
  data: Record<string, unknown>,
  actorId: string,
  channelId?: string
): Promise<{ queued: number }> {
  // Find all active webhooks subscribed to this event type
  const { rows: webhooks } = await pool.query<{
    id: string; url: string; secret: string; events: string; channel_id: string
  }>(`
    SELECT id, url, secret, events, channel_id
    FROM aaelink.webhooks_v2
    WHERE is_active = true
  `)

  const now = Date.now()
  let queued = 0

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
    }), now, actorId])

    // Also log delivery record
    await pool.query(`
      INSERT INTO aaelink.webhook_deliveries_v2
        (id, webhook_id, event_type, status, status_code, attempts, next_retry_at,
         request_body, response_body, latency_ms, error_message, created_at)
      VALUES ($1, $2, $3, 'queued', 0, 0, 0, $4, '', 0, '', $5)
    `, [deliveryId, wh.id, eventType, payload, now])

    queued++
  }

  return { queued }
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
