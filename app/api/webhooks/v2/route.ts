// keep: external integration entry point (webhook / IdP / push provider / device)
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID, createHmac, timingSafeEqual } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { webhookDeliveries } from '@/lib/infra/metrics'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Webhooks v2 API — HMAC-signed, retryable, event-filtered webhook delivery.
 *
 * GET  /api/webhooks/v2 — list webhook subscriptions with delivery stats
 * POST /api/webhooks/v2 — create subscription or trigger delivery
 * PUT  /api/webhooks/v2 — update subscription config
 *
 * v2 Features (vs v1):
 *   - HMAC-SHA256 request signing (`X-AAELink-Signature-256` header)
 *   - Event type filtering (subscribe to specific events)
 *   - Exponential backoff retry (1s → 2s → 4s → 8s → 16s → 32s → fail)
 *   - Delivery timeout (10s per attempt)
 *   - Dead letter queue for persistent failures
 *   - Request/response body capture for debugging
 *   - Rate limiting per webhook (max 60/min)
 *
 * Event types:
 *   message.created, message.updated, message.deleted
 *   channel.created, channel.archived, channel.member_joined, channel.member_left
 *   user.created, user.updated, user.deactivated
 *   reaction.added, reaction.removed
 *   file.uploaded, file.deleted
 *   call.started, call.ended
 *   compliance.dlp_violation, compliance.legal_hold_created
 */

const EVENT_TYPES = [
  'message.created', 'message.updated', 'message.deleted',
  'channel.created', 'channel.archived', 'channel.member_joined', 'channel.member_left',
  'user.created', 'user.updated', 'user.deactivated',
  'reaction.added', 'reaction.removed',
  'file.uploaded', 'file.deleted',
  'call.started', 'call.ended',
  'compliance.dlp_violation', 'compliance.legal_hold_created',
] as const

const MAX_RETRIES = 6
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 32000]

/**
 * Generate HMAC-SHA256 signature for webhook payload
 */
function signPayload(payload: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(payload, 'utf8').digest('hex')}`
}

/**
 * Verify a webhook signature (for webhook receivers)
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = signPayload(payload, secret)
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}

async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const view = req.nextUrl.searchParams.get('view') || ''
  const webhookId = req.nextUrl.searchParams.get('webhook_id') || ''

  // Delivery log for a specific webhook
  if (view === 'deliveries' && webhookId) {
    const { rows } = await pool.query(`
      SELECT id, event_type, status, status_code, attempts, next_retry_at,
             request_body, response_body, latency_ms, error_message, created_at
      FROM aaelink.webhook_deliveries_v2
      WHERE webhook_id = $1
      ORDER BY created_at DESC
      LIMIT 50
    `, [webhookId])

    return NextResponse.json({
      deliveries: rows.map(r => ({
        ...r,
        created_at: Number(r.created_at),
        next_retry_at: Number(r.next_retry_at || 0),
        request_body: r.request_body ? JSON.parse(String(r.request_body)) : null,
      }))
    })
  }

  // Available event types
  if (view === 'event_types') {
    return NextResponse.json({ event_types: EVENT_TYPES })
  }

  // List all v2 webhooks
  const { rows } = await pool.query(`
    SELECT w.*, 
           (SELECT COUNT(*)::int FROM aaelink.webhook_deliveries_v2 d WHERE d.webhook_id = w.id AND d.created_at > $1) AS deliveries_24h,
           (SELECT COUNT(*)::int FROM aaelink.webhook_deliveries_v2 d WHERE d.webhook_id = w.id AND d.status = 'failed' AND d.created_at > $1) AS failures_24h
    FROM aaelink.webhooks_v2 w
    WHERE w.created_by = $2 OR EXISTS (
      SELECT 1 FROM aaelink.users u WHERE u.id = $2 AND u.platform_role IN ('super_admin', 'platform_admin')
    )
    ORDER BY w.created_at DESC
  `, [Date.now() - 86400000, uid])

  return NextResponse.json({
    webhooks: rows.map(r => ({
      ...r,
      secret: '***', // Never expose
      created_at: Number(r.created_at),
    }))
  })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    action?: 'create' | 'deliver' | 'test' | 'retry'
    // Create
    name?: string; url?: string; events?: string[]; channel_id?: string
    // Deliver
    webhook_id?: string; event_type?: string; payload?: Record<string, unknown>
    // Retry
    delivery_id?: string
  }

  if (body.action === 'create' || !body.action) {
    const name = String(body.name || '').trim()
    const url = String(body.url || '').trim()
    if (!name || !url) return NextResponse.json({ error: 'name_and_url_required' }, { status: 400 })

    // Validate URL
    try { new URL(url) } catch { return NextResponse.json({ error: 'invalid_url' }, { status: 400 }) }

    // Validate event filters
    const events = Array.isArray(body.events) && body.events.length > 0
      ? body.events.filter(e => EVENT_TYPES.includes(e as typeof EVENT_TYPES[number]))
      : [...EVENT_TYPES]

    const id = randomUUID()
    const secret = `whsec_${randomUUID().replace(/-/g, '')}`
    const now = Date.now()

    await pool.query(`
      INSERT INTO aaelink.webhooks_v2
        (id, name, url, secret, events, channel_id, is_active, max_retries,
         timeout_ms, rate_limit_per_min, created_by, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, true, $7, 10000, 60, $8, $9)
    `, [id, name, url, secret, JSON.stringify(events), body.channel_id || '',
        MAX_RETRIES, uid, now])

    return NextResponse.json({
      webhook: { id, name, url, events, is_active: true, created_at: now },
      secret, // Show ONCE on creation
      instructions: 'Save this secret — it will not be shown again. Use it to verify webhook signatures.',
    }, { status: 201 })
  }

  if (body.action === 'deliver') {
    // Queue a webhook delivery
    const webhookId = String(body.webhook_id || '').trim()
    const eventType = String(body.event_type || '').trim()
    if (!webhookId || !eventType) {
      return NextResponse.json({ error: 'webhook_id_and_event_type_required' }, { status: 400 })
    }

    // Get webhook config
    const { rows: [webhook] } = await pool.query<{
      url: string; secret: string; events: string; is_active: boolean
    }>(`SELECT url, secret, events, is_active FROM aaelink.webhooks_v2 WHERE id = $1`, [webhookId])

    if (!webhook) return NextResponse.json({ error: 'webhook_not_found' }, { status: 404 })
    if (!webhook.is_active) return NextResponse.json({ error: 'webhook_disabled' }, { status: 409 })

    // Check event filter
    const allowedEvents: string[] = JSON.parse(webhook.events || '[]')
    if (allowedEvents.length > 0 && !allowedEvents.includes(eventType)) {
      return NextResponse.json({ error: 'event_type_not_subscribed' }, { status: 400 })
    }

    const payload = JSON.stringify({
      event: eventType,
      timestamp: new Date().toISOString(),
      data: body.payload || {},
    })

    const signature = signPayload(payload, webhook.secret)
    const deliveryId = randomUUID()
    const now = Date.now()

    // Attempt delivery
    let status = 'pending'
    let statusCode = 0
    let responseBody = ''
    let errorMessage = ''
    let latencyMs = 0

    try {
      const start = performance.now()
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)

      const res = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'AAELink-Webhook/2.0',
          'X-AAELink-Delivery-ID': deliveryId,
          'X-AAELink-Event': eventType,
          'X-AAELink-Signature-256': signature,
          'X-AAELink-Timestamp': String(now),
        },
        body: payload,
        signal: controller.signal,
      })

      clearTimeout(timeout)
      latencyMs = Math.round(performance.now() - start)
      statusCode = res.status
      responseBody = await res.text().catch(() => '')

      status = res.ok ? 'delivered' : 'failed'
      webhookDeliveries.inc({ status, event: eventType })
    } catch (err: unknown) {
      status = 'failed'
      errorMessage = err instanceof Error ? err.message : 'Unknown error'
      webhookDeliveries.inc({ status: 'error', event: eventType })
    }

    // Log delivery
    await pool.query(`
      INSERT INTO aaelink.webhook_deliveries_v2
        (id, webhook_id, event_type, status, status_code, attempts, next_retry_at,
         request_body, response_body, latency_ms, error_message, created_at)
      VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, $9, $10, $11)
    `, [deliveryId, webhookId, eventType, status, statusCode,
        status === 'failed' ? now + RETRY_DELAYS_MS[0] : 0,
        payload, responseBody.slice(0, 4096), latencyMs, errorMessage, now])

    return NextResponse.json({
      delivery: {
        id: deliveryId, status, status_code: statusCode,
        latency_ms: latencyMs, error: errorMessage || undefined,
        signature,
      }
    })
  }

  if (body.action === 'test') {
    const webhookId = String(body.webhook_id || '').trim()
    if (!webhookId) return NextResponse.json({ error: 'webhook_id_required' }, { status: 400 })

    // Send a test event
    const { rows: [webhook] } = await pool.query<{
      url: string; secret: string
    }>(`SELECT url, secret FROM aaelink.webhooks_v2 WHERE id = $1`, [webhookId])

    if (!webhook) return NextResponse.json({ error: 'webhook_not_found' }, { status: 404 })

    const testPayload = JSON.stringify({
      event: 'webhook.test',
      timestamp: new Date().toISOString(),
      data: { message: 'This is a test webhook delivery from AAELink v2.' },
    })

    const signature = signPayload(testPayload, webhook.secret)
    let testStatus = 'success'
    let statusCode = 0

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      const res = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'AAELink-Webhook/2.0',
          'X-AAELink-Event': 'webhook.test',
          'X-AAELink-Signature-256': signature,
        },
        body: testPayload,
        signal: controller.signal,
      })
      clearTimeout(timeout)
      statusCode = res.status
      if (!res.ok) testStatus = 'failed'
    } catch {
      testStatus = 'failed'
    }

    return NextResponse.json({ test: testStatus, status_code: statusCode, signature })
  }

  if (body.action === 'retry') {
    const deliveryId = String(body.delivery_id || '').trim()
    if (!deliveryId) return NextResponse.json({ error: 'delivery_id_required' }, { status: 400 })

    // Queue retry via jobs
    const now = Date.now()
    await pool.query(`
      INSERT INTO aaelink.jobs (id, type, status, priority, payload, run_after, max_retries, attempts, created_by, created_at)
      VALUES ($1, 'webhook_retry', 'pending', 5, $2, $3, 3, 0, $4, $3)
    `, [randomUUID(), JSON.stringify({ delivery_id: deliveryId }), now, uid])

    return NextResponse.json({ ok: true, retry_queued: deliveryId })
  }

  return NextResponse.json({ error: 'action required (create|deliver|test|retry)' }, { status: 400 })
}

async function _PUT(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    webhook_id?: string; is_active?: boolean; events?: string[]
    url?: string; name?: string
  }

  const webhookId = String(body.webhook_id || '').trim()
  if (!webhookId) return NextResponse.json({ error: 'webhook_id_required' }, { status: 400 })

  const updates: string[] = []
  const params: unknown[] = []

  if (body.is_active !== undefined) { params.push(body.is_active); updates.push(`is_active = $${params.length}`) }
  if (body.events) {
    const valid = body.events.filter(e => EVENT_TYPES.includes(e as typeof EVENT_TYPES[number]))
    params.push(JSON.stringify(valid)); updates.push(`events = $${params.length}`)
  }
  if (body.url) { params.push(body.url); updates.push(`url = $${params.length}`) }
  if (body.name) { params.push(body.name); updates.push(`name = $${params.length}`) }

  if (updates.length === 0) return NextResponse.json({ error: 'no_updates' }, { status: 400 })
  params.push(webhookId)

  const { rowCount } = await pool.query(
    `UPDATE aaelink.webhooks_v2 SET ${updates.join(', ')} WHERE id = $${params.length}`,
    params
  )
  if (!rowCount) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  return NextResponse.json({ ok: true, updated: webhookId })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/webhooks/v2', _GET)
export const POST   = tracedRoute('POST', '/api/webhooks/v2', _POST)
export const PUT    = tracedRoute('PUT', '/api/webhooks/v2', _PUT)
