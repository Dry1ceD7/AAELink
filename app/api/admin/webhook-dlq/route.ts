import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'
import { WebhookDLQ } from '@/lib/webhookDlq'

/**
 * Admin Webhook DLQ API
 *
 * GET  /api/admin/webhook-dlq — get DLQ stats, dead letters, circuit breakers
 * POST /api/admin/webhook-dlq — replay, purge, or reset circuit breakers
 *   Actions: stats, dead_letters, replay, purge, reset_circuit, reset_all_circuits
 */

// Singleton DLQ (survives across requests in same process)
let dlqInstance: WebhookDLQ | null = null
export function getWebhookDLQ(): WebhookDLQ {
  if (!dlqInstance) dlqInstance = new WebhookDLQ()
  return dlqInstance
}

async function _GET(req: NextRequest) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'admin_required' }, { status: 403 })
  }

  const dlq = getWebhookDLQ()
  const stats = dlq.getStats()
  const deadLetters = dlq.getDeadLetters()

  return NextResponse.json({
    stats,
    dead_letters: deadLetters.map(d => ({
      id: d.id,
      webhook_id: d.webhook_id,
      endpoint_url: d.endpoint_url,
      attempts: d.attempts,
      last_error: d.last_error,
      created_at: d.created_at,
      dead_at: d.dead_at,
      response_status: d.response_status,
    })),
    circuit_breakers: stats.circuitBreakers,
  })
}

async function _POST(req: NextRequest) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'admin_required' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: string
    delivery_id?: string
    endpoint?: string
    max_age_ms?: number
  }

  const dlq = getWebhookDLQ()

  if (body.action === 'stats') {
    return NextResponse.json({ stats: dlq.getStats() })
  }

  if (body.action === 'replay' && body.delivery_id) {
    const ok = dlq.replay(body.delivery_id)
    if (!ok) return NextResponse.json({ error: 'delivery_not_found_or_not_dead' }, { status: 404 })
    return NextResponse.json({ ok: true, delivery_id: body.delivery_id })
  }

  if (body.action === 'purge') {
    const maxAge = body.max_age_ms || 86400000 // default 24h
    const purged = dlq.purge(maxAge)
    return NextResponse.json({ ok: true, purged })
  }

  if (body.action === 'reset_circuit' && body.endpoint) {
    dlq.getCircuitBreaker().resetCircuit(body.endpoint)
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'reset_all_circuits') {
    dlq.getCircuitBreaker().resetAll()
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'process') {
    const processed = await dlq.processQueue()
    return NextResponse.json({ ok: true, processed })
  }

  return NextResponse.json({
    error: 'unknown_action',
    valid_actions: ['stats', 'replay', 'purge', 'reset_circuit', 'reset_all_circuits', 'process']
  }, { status: 400 })
}

export const GET  = tracedRoute('GET',  '/api/admin/webhook-dlq', _GET)
export const POST = tracedRoute('POST', '/api/admin/webhook-dlq', _POST)
