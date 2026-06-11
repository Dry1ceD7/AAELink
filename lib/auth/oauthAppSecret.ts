import { createHash, timingSafeEqual } from 'crypto'

/**
 * OAuth-app client_secret hashing + verification.
 *
 * Historically `aaelink.oauth_apps.client_secret` stored the secret in
 * plaintext and the token-exchange route compared it via a SQL `WHERE
 * client_secret = $2` equality — both a storage and a (non-constant-time,
 * DB-side) comparison footgun.
 *
 * We now store a one-way SHA-256 hash, matching the approach the OpenID RP
 * route already uses for its client secret (createHash('sha256') hex digest;
 * see app/api/auth/openid/route.ts). Stored hashes carry an explicit
 * `sha256:` prefix marker so we can cheaply tell a hashed value from a legacy
 * plaintext row (plaintext secrets are opaque random strings that never begin
 * with that marker). Verification is done in JS with a constant-time compare,
 * never in a SQL predicate.
 *
 * BACK-COMPAT: rows written before this change hold plaintext. verifyAppSecret
 * detects those (no `sha256:` prefix), compares them in constant time, and the
 * caller lazily upgrades them in place on a successful verify.
 */

const HASH_PREFIX = 'sha256:'

/** Produce the at-rest representation of a client secret (prefixed sha256 hex). */
export function hashAppSecret(plaintext: string): string {
  const digest = createHash('sha256').update(plaintext, 'utf8').digest('hex')
  return `${HASH_PREFIX}${digest}`
}

/** True when a stored value is already in the hashed (prefixed) form. */
export function isHashedAppSecret(stored: string): boolean {
  return typeof stored === 'string' && stored.startsWith(HASH_PREFIX)
}

/** Constant-time compare of two strings (length-safe via fixed-width digests). */
function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) {
    // Still burn a comparison against a same-length buffer to avoid leaking the
    // length difference via timing, then fail.
    timingSafeEqual(ab, Buffer.alloc(ab.length))
    return false
  }
  return timingSafeEqual(ab, bb)
}

/**
 * Verify a presented secret against the stored value.
 *
 * Returns:
 *  - ok: whether the secret is correct.
 *  - needsUpgrade: true when the match succeeded against a legacy plaintext row,
 *    signalling the caller to UPDATE the row to hashAppSecret(presented).
 *
 * Both the hashed and plaintext branches compare in constant time.
 */
export function verifyAppSecret(
  presented: string,
  stored: string,
): { ok: boolean; needsUpgrade: boolean } {
  if (isHashedAppSecret(stored)) {
    const ok = constantTimeEqual(hashAppSecret(presented), stored)
    return { ok, needsUpgrade: false }
  }
  // Legacy plaintext row: compare the FIXED-WIDTH sha256 digests of both sides
  // rather than the raw strings. Hashing both first makes the operands always
  // equal length (71 chars), so this branch hits the genuine timingSafeEqual
  // path too — eliminating the length-timing channel that a raw same-vs-different
  // length compare would otherwise leak about the stored plaintext. A match here
  // still flags needsUpgrade so the caller rewrites the row to the hashed form.
  const ok = constantTimeEqual(hashAppSecret(presented), hashAppSecret(stored))
  return { ok, needsUpgrade: ok }
}
