/**
 * AAELink — interactivity ingress verification + app resolution (Integrations
 * parity §29).
 *
 * The audit found the entire interactivity *ingress* path absent: there was no
 * endpoint to receive block_actions / view_submission / shortcut payloads from a
 * button click or modal submit. This module is the ingress→pipeline bridge used by
 * POST /api/integrations/interactivity:
 *
 *   1. Verify the inbound HMAC signature against a registered Events-API
 *      subscription's signing_secret — the SAME secret the outgoing Events API
 *      signs deliveries with (lib/webhooks/webhookEmitter). This REPLACES session
 *      auth (external apps call it); there is no readSessionUserId here.
 *   2. Enforce a 5-minute timestamp skew window to block replay.
 *   3. Resolve which app/subscription sent it (the one whose secret validated).
 *
 * Signature scheme (documented contract for app developers):
 *   X-AAELink-Timestamp:    <unix-ms> sent by the app
 *   X-AAELink-Signature-256: sha256=HMAC_SHA256(signing_secret, `${timestamp}.${rawBody}`)
 *
 * The timestamp is folded into the signed string so a captured payload cannot be
 * replayed with a fresh timestamp. The raw body (not a re-serialized object) is
 * signed so byte-for-byte verification is possible.
 */

import type { Pool } from 'pg'
import { createHmac, timingSafeEqual } from 'crypto'

export const INTERACTIVITY_SIGNATURE_HEADER = 'x-aaelink-signature-256'
export const INTERACTIVITY_TIMESTAMP_HEADER = 'x-aaelink-timestamp'
/** Max timestamp skew (5 minutes) to block replay. */
export const MAX_SKEW_MS = 5 * 60_000

/** Compute the canonical signature for an interactivity request. */
export function signInteractivity(signingSecret: string, timestamp: number, rawBody: string): string {
  return `sha256=${createHmac('sha256', signingSecret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex')}`
}

/** Constant-time string compare that tolerates differing lengths. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export type VerifyOutcome =
  | { ok: true; subscriptionId: string; botId: string | null; workspaceId: string | null }
  | { ok: false; status: 400 | 401 | 404; error: string }

export interface ActiveSubscription {
  id: string
  bot_id: string | null
  workspace_id: string | null
  signing_secret: string
}

/**
 * Load all active Events-API subscriptions that have a signing secret. These are
 * the registered apps eligible to call the interactivity endpoint. (The same
 * registry the outgoing Events API delivers to — so a single app registration
 * gives both outbound events and inbound interactivity.)
 */
export async function loadActiveSubscriptions(pool: Pool): Promise<ActiveSubscription[]> {
  const { rows } = await pool.query<ActiveSubscription>(
    `SELECT id, bot_id, workspace_id, signing_secret
       FROM aaelink.event_subscriptions
      WHERE status = 'active' AND signing_secret IS NOT NULL AND signing_secret <> ''`
  )
  return rows
}

/**
 * Verify an inbound interactivity request and resolve its app. Pure given the
 * subscription set, so unit-testable without a live signing exchange.
 *
 *   - 400 missing_signature / missing_timestamp / bad_timestamp — malformed.
 *   - 401 invalid_signature — no active subscription's secret produced a match.
 *   - 401 stale_timestamp — outside the skew window (replay guard).
 *   - 404 unknown_app — no eligible subscriptions exist at all.
 */
export function verifyInteractivity(args: {
  subscriptions: ActiveSubscription[]
  signatureHeader: string | null
  timestampHeader: string | null
  rawBody: string
  now?: number
}): VerifyOutcome {
  const { subscriptions, signatureHeader, timestampHeader, rawBody } = args
  const now = args.now ?? Date.now()

  if (!signatureHeader) return { ok: false, status: 400, error: 'missing_signature' }
  if (!timestampHeader) return { ok: false, status: 400, error: 'missing_timestamp' }

  const ts = Number(timestampHeader)
  if (!Number.isFinite(ts) || ts <= 0) return { ok: false, status: 400, error: 'bad_timestamp' }

  // Replay guard: reject before doing crypto on stale requests.
  if (Math.abs(now - ts) > MAX_SKEW_MS) {
    return { ok: false, status: 401, error: 'stale_timestamp' }
  }

  if (subscriptions.length === 0) {
    return { ok: false, status: 404, error: 'unknown_app' }
  }

  // Try each active subscription's secret; the one that validates is the sender.
  for (const sub of subscriptions) {
    const expected = signInteractivity(sub.signing_secret, ts, rawBody)
    if (safeEqual(expected, signatureHeader)) {
      return { ok: true, subscriptionId: sub.id, botId: sub.bot_id, workspaceId: sub.workspace_id }
    }
  }

  return { ok: false, status: 401, error: 'invalid_signature' }
}

// ── Replay nonce store (single-use signature within the skew window) ─────────
//
// The timestamp window alone is replay-PRONE: a captured, validly-signed request
// can be re-fired verbatim until its timestamp goes stale. claimInteractivityNonce
// records each accepted signature so a second presentation is rejected. The store
// is Redis SET NX PX (cross-replica) when REDIS_URL is set + ioredis is installed,
// otherwise a per-process Map with TTL. TTL is the skew window, so the entry lives
// exactly as long as the signature could still pass the timestamp check. On a store
// error the claim FAILS OPEN (returns true) so a Redis outage never drops
// legitimate interactions — the timestamp window remains the floor of protection.

interface NonceEntry { expiresAt: number }
const processNonces = new Map<string, NonceEntry>()
if (typeof setInterval === 'function') {
  const t = setInterval(() => {
    const now = Date.now()
    for (const [k, v] of processNonces) if (now >= v.expiresAt) processNonces.delete(k)
  }, 60_000)
  if (t && typeof t === 'object' && 'unref' in t) (t as { unref: () => void }).unref()
}

interface IoredisSetNx {
  set(key: string, val: string, mode: 'PX', ttl: number, nx: 'NX'): Promise<string | null>
}
let nonceRedis: IoredisSetNx | null = null
let nonceRedisProbed = false
async function ensureNonceRedis(): Promise<IoredisSetNx | null> {
  if (nonceRedisProbed) return nonceRedis
  nonceRedisProbed = true
  const url = process.env.REDIS_URL?.trim()
  if (!url) return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const specifier = 'ioredis' as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await (import(specifier).catch(() => null) as Promise<any>)
    if (!mod) return null
    const Redis = (mod as { default?: unknown; Redis?: unknown }).default
      ?? (mod as { default?: unknown; Redis?: unknown }).Redis ?? mod
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nonceRedis = new (Redis as any)(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false }) as IoredisSetNx
  } catch {
    nonceRedis = null
  }
  return nonceRedis
}

/**
 * Claim a signature as single-use within the replay window. Returns true when this
 * is the FIRST time the signature is seen (request may proceed), false when it has
 * already been claimed (replay — reject). TTL defaults to MAX_SKEW_MS.
 */
export async function claimInteractivityNonce(signature: string, now = Date.now(), ttlMs = MAX_SKEW_MS): Promise<boolean> {
  const key = `aaelink:interactivity:nonce:${signature}`
  const client = await ensureNonceRedis()
  if (client) {
    try {
      const res = await client.set(key, '1', 'PX', ttlMs, 'NX')
      return res === 'OK' // null ⇒ key already existed ⇒ replay
    } catch {
      // Store error: fail OPEN (timestamp window still gates) but also record
      // in-process so at least same-node replays are caught.
    }
  }
  const existing = processNonces.get(signature)
  if (existing && now < existing.expiresAt) return false
  processNonces.set(signature, { expiresAt: now + ttlMs })
  return true
}

/** Visible for testing — clear the in-process nonce cache. */
export function __resetInteractivityNoncesForTests(): void {
  processNonces.clear()
  nonceRedis = null
  nonceRedisProbed = false
}
