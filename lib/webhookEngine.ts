/**
 * AAELink Webhook v2 Delivery Engine
 *
 * Production-grade outgoing webhook delivery with:
 *   - HMAC-SHA256 request signing
 *   - Exponential backoff retry (up to max_retries)
 *   - Event-type filtering per subscription
 *   - Delivery logging with latency tracking
 *   - Rate limiting per webhook
 *   - Dead letter queue for exhausted retries
 *
 * Usage:
 *   import { dispatchWebhookEvent } from '@/lib/webhookEngine'
 *   await dispatchWebhookEvent(pool, {
 *     eventType: 'message.created',
 *     payload: { channel_id, message_id, text, user_id },
 *   })
 */

import { Pool } from 'pg'
import { createHmac, randomUUID } from 'crypto'

// ── Types ────────────────────────────────────────────────────────────

interface WebhookSubscription {
  id: string
  name: string
  url: string
  secret: string
  events: string[]
  is_active: boolean
  max_retries: number
  timeout_ms: number
  rate_limit_per_min: number
  created_by: string
  created_at: number
}

interface WebhookEvent {
  eventType: string
  payload: Record<string, unknown>
  channelId?: string
}

interface DeliveryResult {
  webhookId: string
  deliveryId: string
  status: 'delivered' | 'failed' | 'retrying'
  statusCode: number
  latencyMs: number
  error?: string
}

// ── HMAC Signing ─────────────────────────────────────────────────────

/**
 * Generate HMAC-SHA256 signature for webhook payload.
 *
 * The signature is computed over: timestamp + '.' + JSON body
 * This prevents replay attacks when combined with timestamp validation.
 */
export function signPayload(secret: string, timestamp: number, body: string): string {
  const message = `${timestamp}.${body}`
  return createHmac('sha256', secret).update(message).digest('hex')
}

/**
 * Verify an incoming webhook signature.
 *
 * @param secret - The shared secret
 * @param signature - The X-AAELink-Signature header value
 * @param timestamp - The X-AAELink-Timestamp header value
 * @param body - Raw request body
 * @param maxAgeMs - Maximum age of the timestamp (default: 5 minutes)
 */
export function verifySignature(
  secret: string,
  signature: string,
  timestamp: number,
  body: string,
  maxAgeMs = 5 * 60 * 1000
): boolean {
  // Check timestamp freshness (prevent replay attacks)
  const age = Math.abs(Date.now() - timestamp)
  if (age > maxAgeMs) return false

  const expected = signPayload(secret, timestamp, body)
  // Constant-time comparison
  if (expected.length !== signature.length) return false
  let result = 0
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return result === 0
}

// ── Rate Limiting ────────────────────────────────────────────────────

const rateLimitBuckets = new Map<string, { count: number; windowStart: number }>()

function checkRateLimit(webhookId: string, limitPerMin: number): boolean {
  const now = Date.now()
  const bucket = rateLimitBuckets.get(webhookId)

  if (!bucket || now - bucket.windowStart > 60_000) {
    rateLimitBuckets.set(webhookId, { count: 1, windowStart: now })
    return true
  }

  if (bucket.count >= limitPerMin) return false
  bucket.count++
  return true
}

// ── Backoff Calculator ───────────────────────────────────────────────

/**
 * Exponential backoff with jitter.
 *
 * Retry schedule (base 1s):
 *   Attempt 1: ~1s
 *   Attempt 2: ~2s
 *   Attempt 3: ~4s
 *   Attempt 4: ~8s
 *   Attempt 5: ~16s
 *   Attempt 6: ~32s (max)
 */
export function calculateBackoffMs(attempt: number, baseMs = 1000, maxMs = 32_000): number {
  const exponential = Math.min(baseMs * Math.pow(2, attempt), maxMs)
  const jitter = exponential * 0.1 * Math.random()
  return Math.round(exponential + jitter)
}

// ── Delivery Engine ──────────────────────────────────────────────────

/**
 * Deliver a webhook event to a single subscription.
 */
async function deliverToWebhook(
  pool: Pool,
  webhook: WebhookSubscription,
  event: WebhookEvent,
  attempt = 0
): Promise<DeliveryResult> {
  const deliveryId = randomUUID()
  const timestamp = Date.now()
  const body = JSON.stringify({
    event: event.eventType,
    payload: event.payload,
    timestamp,
    delivery_id: deliveryId,
    attempt: attempt + 1,
  })

  // Generate HMAC signature
  const signature = webhook.secret ? signPayload(webhook.secret, timestamp, body) : ''

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'AAELink-Webhook/2.0',
    'X-AAELink-Event': event.eventType,
    'X-AAELink-Delivery': deliveryId,
    'X-AAELink-Timestamp': String(timestamp),
    ...(signature ? { 'X-AAELink-Signature': `sha256=${signature}` } : {}),
  }

  const start = performance.now()
  let statusCode = 0
  let responseBody = ''
  let error = ''

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), webhook.timeout_ms || 10_000)

    const res = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })

    clearTimeout(timeout)
    statusCode = res.status
    responseBody = await res.text().catch(() => '')

    if (!res.ok) {
      error = `HTTP ${statusCode}: ${responseBody.slice(0, 500)}`
    }
  } catch (err: unknown) {
    error = err instanceof Error ? err.message : 'Unknown error'
    if (error.includes('abort')) error = `Timeout after ${webhook.timeout_ms}ms`
  }

  const latencyMs = Math.round(performance.now() - start)
  const isSuccess = statusCode >= 200 && statusCode < 300
  const retriesExhausted = attempt >= (webhook.max_retries || 6)

  let status: 'delivered' | 'failed' | 'retrying'
  let nextRetryAt = 0

  if (isSuccess) {
    status = 'delivered'
  } else if (retriesExhausted) {
    status = 'failed'
  } else {
    status = 'retrying'
    nextRetryAt = Date.now() + calculateBackoffMs(attempt)
  }

  // Log delivery
  try {
    await pool.query(
      `INSERT INTO aaelink.webhook_deliveries_v2
       (id, webhook_id, event_type, status, status_code, attempts, next_retry_at, request_body, response_body, latency_ms, error_message, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        deliveryId,
        webhook.id,
        event.eventType,
        status,
        statusCode,
        attempt + 1,
        nextRetryAt,
        body.slice(0, 4000),
        responseBody.slice(0, 2000),
        latencyMs,
        error.slice(0, 1000),
        timestamp,
      ]
    )
  } catch (dbErr) {
    console.error(`[webhook_v2] Failed to log delivery:`, dbErr)
  }

  // Schedule retry via job queue if needed
  if (status === 'retrying') {
    try {
      await pool.query(
        `INSERT INTO aaelink.jobs (id, type, payload, status, priority, run_after, created_at)
         VALUES ($1, 'webhook_retry', $2, 'pending', 3, $3, $4)`,
        [
          randomUUID(),
          JSON.stringify({
            webhook_id: webhook.id,
            event_type: event.eventType,
            payload: event.payload,
            attempt: attempt + 1,
            delivery_id: deliveryId,
          }),
          nextRetryAt,
          Date.now(),
        ]
      )
    } catch (jobErr) {
      console.error(`[webhook_v2] Failed to schedule retry:`, jobErr)
    }
  }

  return { webhookId: webhook.id, deliveryId, status, statusCode, latencyMs, error }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Dispatch a webhook event to all matching active subscriptions.
 *
 * Filters by event type and rate limit. Delivers in parallel.
 *
 * @returns Array of delivery results
 */
export async function dispatchWebhookEvent(
  pool: Pool,
  event: WebhookEvent
): Promise<DeliveryResult[]> {
  // Find all active webhook subscriptions matching this event type
  const { rows } = await pool.query<WebhookSubscription>(
    `SELECT * FROM aaelink.webhooks_v2 WHERE is_active = true`
  )

  const matchingWebhooks = rows.filter(w => {
    const events = Array.isArray(w.events) ? w.events : []
    // Match if events is empty (subscribe to all) or contains the event type
    if (events.length === 0) return true
    return events.some(e =>
      e === event.eventType ||
      e === '*' ||
      (e.endsWith('.*') && event.eventType.startsWith(e.slice(0, -2)))
    )
  })

  if (matchingWebhooks.length === 0) return []

  // Deliver in parallel, respecting rate limits
  const results = await Promise.all(
    matchingWebhooks.map(async (webhook) => {
      if (!checkRateLimit(webhook.id, webhook.rate_limit_per_min || 60)) {
        return {
          webhookId: webhook.id,
          deliveryId: '',
          status: 'failed' as const,
          statusCode: 429,
          latencyMs: 0,
          error: 'Rate limit exceeded',
        }
      }

      return deliverToWebhook(pool, webhook, event)
    })
  )

  return results
}

/**
 * Retry a failed webhook delivery (called by the worker).
 */
export async function retryWebhookDelivery(
  pool: Pool,
  payload: {
    webhook_id: string
    event_type: string
    payload: Record<string, unknown>
    attempt: number
  }
): Promise<DeliveryResult | null> {
  // Load webhook subscription
  const { rows } = await pool.query<WebhookSubscription>(
    `SELECT * FROM aaelink.webhooks_v2 WHERE id = $1 AND is_active = true`,
    [payload.webhook_id]
  )

  if (rows.length === 0) return null

  return deliverToWebhook(
    pool,
    rows[0],
    { eventType: payload.event_type, payload: payload.payload },
    payload.attempt
  )
}

/**
 * Get delivery statistics for a webhook.
 */
export async function getWebhookStats(
  pool: Pool,
  webhookId: string,
  days = 7
): Promise<{
  total: number
  delivered: number
  failed: number
  retrying: number
  avgLatencyMs: number
}> {
  const since = Date.now() - days * 24 * 60 * 60 * 1000
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)::int as total,
       COUNT(*) FILTER (WHERE status = 'delivered')::int as delivered,
       COUNT(*) FILTER (WHERE status = 'failed')::int as failed,
       COUNT(*) FILTER (WHERE status = 'retrying')::int as retrying,
       COALESCE(AVG(latency_ms), 0)::int as avg_latency_ms
     FROM aaelink.webhook_deliveries_v2
     WHERE webhook_id = $1 AND created_at > $2`,
    [webhookId, since]
  )

  const r = rows[0] as Record<string, number>
  return {
    total: r.total || 0,
    delivered: r.delivered || 0,
    failed: r.failed || 0,
    retrying: r.retrying || 0,
    avgLatencyMs: r.avg_latency_ms || 0,
  }
}
