/**
 * AAELink — Inbound Webhook Signature Verification
 *
 * The public incoming-webhook receiver (app/api/webhooks/[token]/route.ts) is
 * the mirror image of the OUTBOUND signer in lib/webhooks/webhookSigning.ts:
 * the SAME v0 HMAC-SHA256 scheme, the SAME header names, and a constant-time
 * compare via verifySignature(). An external system that signs its POST with a
 * webhook's signing_secret (exactly how AAELink signs its own outbound calls)
 * is accepted; a forged/absent signature is rejected.
 *
 * Back-compat: a webhook with NO signing_secret stays OPEN — verifyInbound()
 * returns { required: false } and the caller skips verification. This preserves
 * the receiver's original unauthenticated behaviour for already-provisioned
 * webhooks; only webhooks that opt in (non-empty signing_secret) are enforced.
 */
import {
  verifySignature,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from '@/lib/webhooks/webhookSigning'

export interface InboundVerifyResult {
  /** Whether a signature was required for this webhook (secret configured). */
  required: boolean
  /** Whether the request passed verification (always true when not required). */
  valid: boolean
  /** Machine-readable reason for a failure (snake_case). */
  reason: string
}

/**
 * Verify the inbound POST signature against a webhook's signing secret.
 *
 * @param secret  The webhook's signing_secret ('' / null = open, no verification)
 * @param rawBody The exact raw request body string that was signed
 * @param headers The inbound request headers
 */
export function verifyInbound(
  secret: string | null | undefined,
  rawBody: string,
  headers: Headers,
): InboundVerifyResult {
  const s = (secret || '').trim()
  // No secret configured → open webhook (documented back-compat path).
  if (!s) return { required: false, valid: true, reason: 'no_secret' }

  const signature = headers.get(SIGNATURE_HEADER) || ''
  const timestamp = headers.get(TIMESTAMP_HEADER) || ''
  if (!signature || !timestamp) {
    return { required: true, valid: false, reason: 'missing_signature' }
  }

  const res = verifySignature(s, rawBody, signature, timestamp)
  return { required: true, valid: res.valid, reason: res.reason }
}
