/**
 * AAELink Webhook Signing
 *
 * HMAC-SHA256 signatures for outbound webhook payloads:
 *   - Signs every outbound payload with a per-webhook secret
 *   - Includes timestamp to prevent replay attacks
 *   - Provides verification helper for inbound webhook consumers
 *   - Compatible with Slack/Stripe signature format
 *
 * Signature header: X-AAELink-Signature
 * Timestamp header: X-AAELink-Timestamp
 *
 * Signed string format: `v0:${timestamp}:${body}`
 * Signature format:     `v0=${hmac_hex}`
 */
import { createHmac, timingSafeEqual } from 'crypto'

// ── Constants ────────────────────────────────────────────────────────

export const SIGNATURE_VERSION = 'v0'
export const SIGNATURE_HEADER  = 'x-aaelink-signature'
export const TIMESTAMP_HEADER  = 'x-aaelink-timestamp'

/** Max age for signature verification (5 minutes) */
export const MAX_TIMESTAMP_AGE_MS = 300_000

// ── Signing ──────────────────────────────────────────────────────────

/**
 * Sign a webhook payload with HMAC-SHA256.
 *
 * @param secret   The webhook's signing secret
 * @param body     The raw request body (JSON string)
 * @param timestamp Optional Unix timestamp in seconds (defaults to now)
 * @returns Object with signature, timestamp, and headers to attach
 */
export function signPayload(
  secret: string,
  body: string,
  timestamp?: number,
): { signature: string; timestamp: number; headers: Record<string, string> } {
  const ts = timestamp ?? Math.floor(Date.now() / 1000)
  const sigBase = `${SIGNATURE_VERSION}:${ts}:${body}`
  const hmac = createHmac('sha256', secret).update(sigBase).digest('hex')
  const signature = `${SIGNATURE_VERSION}=${hmac}`

  return {
    signature,
    timestamp: ts,
    headers: {
      [SIGNATURE_HEADER]: signature,
      [TIMESTAMP_HEADER]: String(ts),
      'content-type': 'application/json',
    },
  }
}

// ── Verification ─────────────────────────────────────────────────────

export interface VerifyResult {
  valid: boolean
  reason: string
}

/**
 * Verify a webhook signature.
 *
 * @param secret    The webhook's signing secret
 * @param body      The raw request body (JSON string)
 * @param signature The X-AAELink-Signature header value
 * @param timestamp The X-AAELink-Timestamp header value (Unix seconds)
 * @param maxAge    Max acceptable age in ms (default: 5 minutes)
 */
export function verifySignature(
  secret: string,
  body: string,
  signature: string,
  timestamp: string | number,
  maxAge: number = MAX_TIMESTAMP_AGE_MS,
): VerifyResult {
  // Parse timestamp
  const ts = typeof timestamp === 'string' ? parseInt(timestamp, 10) : timestamp
  if (isNaN(ts) || ts <= 0) {
    return { valid: false, reason: 'invalid_timestamp' }
  }

  // Check timestamp age (prevent replay)
  const now = Math.floor(Date.now() / 1000)
  const age = Math.abs(now - ts) * 1000
  if (age > maxAge) {
    return { valid: false, reason: 'timestamp_expired' }
  }

  // Parse signature
  if (!signature.startsWith(`${SIGNATURE_VERSION}=`)) {
    return { valid: false, reason: 'invalid_signature_format' }
  }
  const receivedHmac = signature.slice(SIGNATURE_VERSION.length + 1)

  // Compute expected
  const sigBase = `${SIGNATURE_VERSION}:${ts}:${body}`
  const expectedHmac = createHmac('sha256', secret).update(sigBase).digest('hex')

  // Timing-safe comparison
  try {
    const a = Buffer.from(receivedHmac, 'hex')
    const b = Buffer.from(expectedHmac, 'hex')
    if (a.length !== b.length) {
      return { valid: false, reason: 'signature_mismatch' }
    }
    if (!timingSafeEqual(a, b)) {
      return { valid: false, reason: 'signature_mismatch' }
    }
  } catch {
    return { valid: false, reason: 'signature_mismatch' }
  }

  return { valid: true, reason: 'ok' }
}

// ── Secret Generation ────────────────────────────────────────────────

/** Generate a cryptographically secure signing secret */
export function generateSigningSecret(length: number = 32): string {
  const { randomBytes } = require('crypto') as typeof import('crypto')
  return `whsec_${randomBytes(length).toString('hex')}`
}
