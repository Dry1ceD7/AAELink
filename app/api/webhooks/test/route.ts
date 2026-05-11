import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { isPlatformAdmin } from '@/lib/platformRole'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * POST /api/webhooks/test — Send a test payload to a webhook's callback URL.
 * Admin only. For outgoing webhooks with a callback_url.
 */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!isPlatformAdmin(uRows[0]?.platform_role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as { webhook_id?: string }
  const whId = String(body.webhook_id || '').trim()
  if (!whId) return NextResponse.json({ error: 'webhook_id_required' }, { status: 400 })

  const { rows } = await pool.query<{
    id: string; kind: string; callback_url: string; display_name: string; is_active: boolean
  }>(
    `SELECT id, kind, callback_url, display_name, is_active FROM aaelink.webhooks WHERE id = $1`,
    [whId]
  )
  const wh = rows[0]
  if (!wh) return NextResponse.json({ error: 'webhook_not_found' }, { status: 404 })

  // For incoming webhooks, there's no callback to test
  if (wh.kind === 'incoming') {
    return NextResponse.json({
      ok: true,
      test_type: 'incoming',
      message: 'Incoming webhooks receive messages via their token URL. Use the token to POST a message to the channel.'
    })
  }

  if (!wh.callback_url) {
    return NextResponse.json({ error: 'no_callback_url', message: 'This webhook has no callback URL configured.' }, { status: 400 })
  }

  const testPayload = {
    event: 'test',
    webhook_id: wh.id,
    webhook_name: wh.display_name,
    timestamp: new Date().toISOString(),
    message: 'This is a test delivery from AAELink webhook system.',
    data: {
      channel_id: null,
      channel_name: null,
      user: 'AAELink System',
      text: 'Test payload — your webhook is working! 🎉'
    }
  }

  let status = 0
  let responseBody = ''
  let error = ''
  const startMs = Date.now()

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)

    const res = await fetch(wh.callback_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AAELink-Event': 'test',
        'X-AAELink-Webhook-Id': wh.id
      },
      body: JSON.stringify(testPayload),
      signal: controller.signal
    })

    clearTimeout(timeout)
    status = res.status
    try {
      responseBody = (await res.text()).slice(0, 500)
    } catch {
      responseBody = '[could not read response body]'
    }
  } catch (e) {
    error = e instanceof Error ? e.message : 'Unknown error'
    if (error.includes('abort')) error = 'Request timed out (10s limit)'
  }

  const durationMs = Date.now() - startMs

  // Log the delivery attempt
  const { randomUUID } = await import('node:crypto')
  await pool.query(
    `INSERT INTO aaelink.webhook_deliveries (id, webhook_id, event, status_code, response_body, error, duration_ms, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [randomUUID(), wh.id, 'test', status, responseBody.slice(0, 500), error, durationMs, Date.now()]
  ).catch(() => { /* table may not exist yet */ })

  return NextResponse.json({
    ok: !error && status >= 200 && status < 400,
    status,
    duration_ms: durationMs,
    response_preview: responseBody.slice(0, 200),
    error: error || undefined
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/webhooks/test', _POST)
