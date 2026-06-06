// keep: external integration entry point — apps POST interactive-component payloads here
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { getRateLimiter } from '@/lib/api/rateLimiter'
import { emitWebhookEvent } from '@/lib/webhooks/webhookEmitter'
import {
  loadActiveSubscriptions,
  verifyInteractivity,
  claimInteractivityNonce,
  INTERACTIVITY_SIGNATURE_HEADER,
  INTERACTIVITY_TIMESTAMP_HEADER,
} from '@/lib/integrations/interactivity'

/** Max accepted interactivity body — reject oversized payloads before any work. */
const MAX_BODY_BYTES = 64 * 1024
/** Per-IP cap: this endpoint is session-less, so throttle the HMAC/DB amplification. */
const RATE_MAX_PER_WINDOW = 60
const RATE_WINDOW_MS = 60_000

/**
 * Interactivity ingress (Integrations parity §29) — Slack's single
 * "Interactivity Request URL" equivalent.
 *
 * POST /api/integrations/interactivity
 *   Receives action payloads from app-rendered Block Kit (button clicks, select
 *   menus, modal submits, shortcuts). Authentication is HMAC signature
 *   verification, NOT a session — external apps call this. The request is signed
 *   with the calling app's Events-API subscription signing_secret:
 *
 *     X-AAELink-Timestamp:     <unix-ms>
 *     X-AAELink-Signature-256: sha256=HMAC_SHA256(secret, `${ts}.${rawBody}`)
 *
 *   On a valid signature the payload is dispatched as an 'interaction' event back
 *   through the existing event_subscriptions pipeline (lib/webhooks/webhookEmitter
 *   → 'event_deliver' jobs), so app backends receive the round-trip. We persist
 *   nothing new — this is purely an ingress→pipeline bridge.
 *
 * Errors: { error: 'snake_case' } with 400 (malformed), 401 (invalid/stale
 * signature), 404 (no registered app).
 */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  // Rate-limit FIRST (before any DB load or HMAC work). This endpoint has no
  // session, loads every active subscription, and computes one HMAC per
  // subscription on a bad signature — an unauthenticated flood would otherwise
  // force N*HMAC + a full subscription scan per request (CPU/DB amplification) and
  // allow unthrottled signature brute-forcing.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip') || '127.0.0.1'
  const rl = getRateLimiter().check(`interactivity:${ip}`, RATE_MAX_PER_WINDOW, RATE_WINDOW_MS)
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } }
    )
  }

  // Read the RAW body — the signature is computed over the exact bytes, so we
  // must verify against text(), not a re-serialized object. Reject oversized
  // bodies before doing any per-subscription crypto.
  const rawBody = await req.text()
  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 })
  }

  const subscriptions = await loadActiveSubscriptions(pool)
  const signatureHeader = req.headers.get(INTERACTIVITY_SIGNATURE_HEADER)
  const timestampHeader = req.headers.get(INTERACTIVITY_TIMESTAMP_HEADER)
  const outcome = verifyInteractivity({
    subscriptions,
    signatureHeader,
    timestampHeader,
    rawBody,
  })

  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status })
  }

  // Anti-replay: the timestamp skew window alone allows a captured, validly-signed
  // request to be replayed verbatim within MAX_SKEW_MS. Reject any signature we've
  // already seen (single-use within the window). Best-effort Redis SET NX EX with
  // an in-process fallback; a store outage fails OPEN (window-only) rather than
  // dropping legitimate interactions.
  const fresh = await claimInteractivityNonce(signatureHeader as string)
  if (!fresh) {
    return NextResponse.json({ error: 'replayed_signature' }, { status: 401 })
  }

  // Parse the (now-authenticated) payload. A malformed body that still signed
  // correctly is the app's fault — surface it as 400.
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody || '{}') as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 })
  }

  // Dispatch through the existing Events-API pipeline. The actor is the app/bot
  // that signed the request. SECURITY: do NOT use payload.channel_id to scope the
  // fan-out — it is attacker-controlled (the signing app can claim any channel_id)
  // and would let one low-trust app forge interaction events targeting arbitrary
  // channels delivered to co-located subscribers. The fan-out is scoped ONLY by the
  // validated subscription's own workspace (outcome.workspaceId). The app-supplied
  // channel_id is preserved inside the payload but flagged unverified, and the
  // resolved subscription_id is stamped so downstream consumers can authorize.
  const claimedChannelId =
    typeof (payload as { channel_id?: unknown }).channel_id === 'string'
      ? (payload as { channel_id: string }).channel_id
      : undefined

  const result = await emitWebhookEvent(
    pool,
    'interaction',
    {
      type: (payload as { type?: unknown }).type ?? 'block_actions',
      subscription_id: outcome.subscriptionId,
      bot_id: outcome.botId,
      workspace_id: outcome.workspaceId,
      // App-claimed, NOT verified against the signing app's channel access.
      claimed_channel_id: claimedChannelId ?? null,
      payload,
    },
    outcome.botId || outcome.subscriptionId,
    // channelId scope intentionally omitted — see SECURITY note above.
    undefined,
    outcome.workspaceId || undefined,
    // App/bot actor is not a users row; leave the jobs.created_by FK column NULL.
    { createdBy: null },
  )

  // Slack returns 200 with an empty/ack body for interactivity. Mirror that:
  // acknowledge receipt immediately; delivery to subscribers is async via jobs.
  return NextResponse.json({ ok: true, dispatched: result.event_subscriptions }, { status: 200 })
}

// ── Traced export ───────────────────────────────────────────────────
export const POST = tracedRoute('POST', '/api/integrations/interactivity', _POST)
