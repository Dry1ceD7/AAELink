// keep: external integration entry point (webhook / IdP / push provider / device)
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID, randomBytes } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Event Subscriptions API — webhook-based event delivery to external integrations.
 *
 * GET  /api/integrations/events — list event subscriptions
 * POST /api/integrations/events — create a new event subscription
 *
 * Event types:
 *   - message.created, message.updated, message.deleted
 *   - reaction.added, reaction.removed
 *   - channel.created, channel.archived, channel.renamed
 *   - member.joined, member.left
 *   - ticket.created, ticket.updated, ticket.closed
 *   - user.created, user.deactivated
 *   - file.uploaded, file.deleted
 *
 * Delivery:
 *   - HTTP POST to registered endpoint URL
 *   - HMAC-SHA256 signature verification
 *   - Retry with exponential backoff (3 attempts)
 *   - Delivery receipts and failure tracking
 */

const VALID_EVENTS = [
  'message.created', 'message.updated', 'message.deleted',
  'reaction.added', 'reaction.removed',
  'channel.created', 'channel.archived', 'channel.renamed',
  'member.joined', 'member.left',
  'ticket.created', 'ticket.updated', 'ticket.closed',
  'user.created', 'user.deactivated',
  'file.uploaded', 'file.deleted',
  '*', // wildcard — subscribe to all events
] as const

async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const botId = req.nextUrl.searchParams.get('bot_id') || ''

  let where = ''
  const params: string[] = []
  if (botId) { params.push(botId); where = `WHERE e.bot_id = $${params.length}` }

  const { rows } = await pool.query(`
    SELECT e.*, b.name AS bot_name
    FROM aaelink.event_subscriptions e
    LEFT JOIN aaelink.bot_users b ON b.id = e.bot_id
    ${where}
    ORDER BY e.created_at DESC
    LIMIT 100
  `, params)

  return NextResponse.json({
    subscriptions: rows.map(e => ({
      ...e,
      created_at: Number(e.created_at),
      last_delivery_at: Number(e.last_delivery_at || 0),
    })),
    supported_events: VALID_EVENTS,
    total: rows.length,
  })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    bot_id?: string; endpoint_url?: string; events?: string[]
    workspace_id?: string; description?: string
  }

  const endpointUrl = String(body.endpoint_url || '').trim()
  if (!endpointUrl || !endpointUrl.startsWith('https://')) {
    return NextResponse.json({ error: 'https_endpoint_url_required' }, { status: 400 })
  }

  const events = Array.isArray(body.events)
    ? body.events.filter(e => VALID_EVENTS.includes(e as typeof VALID_EVENTS[number]))
    : []
  if (events.length === 0) {
    return NextResponse.json({ error: 'at_least_one_event_required', valid_events: VALID_EVENTS }, { status: 400 })
  }

  const id = randomUUID()
  const signingSecret = `whsec_${randomBytes(24).toString('hex')}`
  const now = Date.now()

  await pool.query(`
    INSERT INTO aaelink.event_subscriptions
      (id, bot_id, endpoint_url, events, signing_secret, status,
       workspace_id, description, delivery_count, failure_count,
       created_by, created_at)
    VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, 0, 0, $8, $9)
  `, [
    id, body.bot_id || null, endpointUrl, JSON.stringify(events),
    signingSecret, body.workspace_id || null, body.description || '',
    uid, now
  ])

  return NextResponse.json({
    subscription: {
      id, endpoint_url: endpointUrl, events, status: 'active',
      signing_secret: signingSecret, // Only shown on creation
      created_at: now,
    }
  }, { status: 201 })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/integrations/events', _GET)
export const POST   = tracedRoute('POST', '/api/integrations/events', _POST)
