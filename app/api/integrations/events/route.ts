// keep: external integration entry point (webhook / IdP / push provider / device)
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID, randomBytes } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import {
  assertSafeCallbackUrl,
  assertCallbackHostResolvesPublic,
  normalizeHostname,
} from '@/lib/security/ssrfGuard'

/**
 * Event Subscriptions API — webhook-based event delivery to external integrations.
 *
 * GET    /api/integrations/events — list event subscriptions
 * POST   /api/integrations/events — create a new event subscription (starts pending;
 *                                   performs url_verification handshake immediately)
 * PATCH  /api/integrations/events — re-verify a pending subscription
 *                                   (body: { action: 'verify', subscription_id })
 *
 * Verification handshake (Slack url_verification parity):
 *   On create (and on explicit re-verify), the server POSTs:
 *     { type: 'url_verification', challenge: <token> }
 *   to the registered endpoint_url. The endpoint must echo the challenge back,
 *   either as JSON { challenge: <token> } or as plain text equal to the token.
 *   On success the subscription becomes status='active', verified=true.
 *   On failure it remains status='pending', verified=false.
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
 *   - HTTP POST to registered endpoint URL (verified endpoints only)
 *   - HMAC-SHA256 signature verification
 *   - Retry with exponential backoff (3 attempts)
 *   - Delivery receipts and failure tracking
 *
 * Subscription status (the `status` field on each returned subscription):
 *   - pending — awaiting url_verification handshake
 *   - active  — verified; receiving events normally
 *   - failing — auto-disabled by the worker after consecutive delivery failures
 *               crossed the runaway threshold with no recent success; the
 *               subscription stops receiving events until it recovers (the worker
 *               flips it back to 'active' on the next successful delivery)
 *   - any non-active value — inactive; not delivered to. The worker only ever
 *     writes 'active' or 'failing'; there is currently no manual disable path.
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

/**
 * Perform the url_verification handshake against endpointUrl.
 * Returns { verified: true } on success, { verified: false, reason } on failure.
 */
async function performUrlVerification(
  endpointUrl: string,
  token: string,
): Promise<{ verified: true } | { verified: false; reason: string }> {
  // SSRF guard before outbound request
  const urlCheck = assertSafeCallbackUrl(endpointUrl)
  if (!urlCheck.ok) return { verified: false, reason: urlCheck.error }

  const dnsCheck = await assertCallbackHostResolvesPublic(normalizeHostname(urlCheck.url.hostname))
  if (!dnsCheck.ok) return { verified: false, reason: dnsCheck.error }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)

  try {
    const res = await fetch(endpointUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'url_verification', challenge: token }),
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!res.ok) {
      return { verified: false, reason: `endpoint_returned_${res.status}` }
    }

    // Accept JSON { challenge: token } or raw text equal to token
    const text = await res.text()
    let echoed = text.trim() === token
    if (!echoed) {
      try {
        const json = JSON.parse(text) as { challenge?: unknown }
        echoed = json?.challenge === token
      } catch { /* not JSON */ }
    }

    return echoed
      ? { verified: true }
      : { verified: false, reason: 'challenge_not_echoed' }
  } catch (err: unknown) {
    clearTimeout(timer)
    const isTimeout = (err as { name?: string })?.name === 'AbortError'
    return { verified: false, reason: isTimeout ? 'timeout' : 'network_error' }
  }
}

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
      verified_at: Number(e.verified_at || 0),
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
  const verificationToken = randomBytes(24).toString('hex')
  const now = Date.now()

  // Insert with status='pending', verified=false
  await pool.query(`
    INSERT INTO aaelink.event_subscriptions
      (id, bot_id, endpoint_url, events, signing_secret, status,
       verified, verification_token, verified_at,
       workspace_id, description, delivery_count, failure_count,
       created_by, created_at)
    VALUES ($1, $2, $3, $4, $5, 'pending', false, $6, 0, $7, $8, 0, 0, $9, $10)
  `, [
    id, body.bot_id || null, endpointUrl, JSON.stringify(events),
    signingSecret, verificationToken,
    body.workspace_id || null, body.description || '',
    uid, now
  ])

  // Audit log — best-effort
  try {
    await pool.query(
      `INSERT INTO aaelink.audit_log (id, actor_id, action, resource_id, metadata, created_at)
       VALUES ($1, $2, 'event_subscription.create', $3, $4, $5)`,
      [randomUUID(), uid, id, JSON.stringify({ endpoint_url: endpointUrl, events }), now]
    )
  } catch { /* audit log is best-effort */ }

  // Perform handshake
  const verification = await performUrlVerification(endpointUrl, verificationToken)

  if (verification.verified) {
    const verifiedAt = Date.now()
    await pool.query(
      `UPDATE aaelink.event_subscriptions
          SET status = 'active', verified = true, verified_at = $2, verification_token = NULL
        WHERE id = $1`,
      [id, verifiedAt]
    )

    return NextResponse.json({
      subscription: {
        id, endpoint_url: endpointUrl, events, status: 'active',
        verified: true, verified_at: verifiedAt,
        signing_secret: signingSecret, // Only shown on creation
        created_at: now,
      }
    }, { status: 201 })
  }

  // Verification failed — leave pending
  return NextResponse.json({
    subscription: {
      id, endpoint_url: endpointUrl, events, status: 'pending',
      verified: false, verified_at: 0,
      signing_secret: signingSecret, // Only shown on creation
      created_at: now,
    },
    verification: 'failed',
    verification_detail: (verification as { verified: false; reason: string }).reason,
  }, { status: 201 })
}

/**
 * PATCH /api/integrations/events
 * body: { action: 'verify', subscription_id: string }
 *
 * Re-runs the url_verification handshake for a pending subscription.
 * On success: flips status='active', verified=true.
 * On failure: leaves pending; returns { verification: 'failed' }.
 */
async function _PATCH(req: NextRequest) {
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
    action?: string; subscription_id?: string
  }

  if (body.action !== 'verify') {
    return NextResponse.json({ error: 'unsupported_action' }, { status: 400 })
  }

  const subId = String(body.subscription_id || '').trim()
  if (!subId) {
    return NextResponse.json({ error: 'subscription_id_required' }, { status: 400 })
  }

  const { rows: subRows } = await pool.query<{
    id: string; endpoint_url: string; status: string; verification_token: string | null
  }>(
    `SELECT id, endpoint_url, status, verification_token
       FROM aaelink.event_subscriptions WHERE id = $1`,
    [subId]
  )

  if (!subRows[0]) {
    return NextResponse.json({ error: 'subscription_not_found' }, { status: 404 })
  }

  const sub = subRows[0]

  if (sub.status === 'active') {
    return NextResponse.json({ error: 'already_verified' }, { status: 409 })
  }

  // Rotate the verification token on each re-verify attempt
  const newToken = randomBytes(24).toString('hex')
  await pool.query(
    `UPDATE aaelink.event_subscriptions SET verification_token = $2 WHERE id = $1`,
    [subId, newToken]
  )

  const verification = await performUrlVerification(sub.endpoint_url, newToken)

  if (verification.verified) {
    const verifiedAt = Date.now()
    await pool.query(
      `UPDATE aaelink.event_subscriptions
          SET status = 'active', verified = true, verified_at = $2, verification_token = NULL
        WHERE id = $1`,
      [subId, verifiedAt]
    )

    return NextResponse.json({
      subscription: { id: subId, status: 'active', verified: true, verified_at: verifiedAt },
    })
  }

  return NextResponse.json({
    subscription: { id: subId, status: sub.status, verified: false },
    verification: 'failed',
    verification_detail: (verification as { verified: false; reason: string }).reason,
  }, { status: 200 })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET   = tracedRoute('GET', '/api/integrations/events', _GET)
export const POST  = tracedRoute('POST', '/api/integrations/events', _POST)
export const PATCH = tracedRoute('PATCH', '/api/integrations/events', _PATCH)
