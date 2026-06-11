import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

/**
 * Recoverable encryption for SSO IdP client secrets.
 *
 * Inbound OIDC (Relying Party) requires the *plaintext* client secret to perform
 * the authorization-code exchange, so the one-way `client_secret_hash` the SSO
 * config route stores is unusable here. We instead persist an AES-256-GCM
 * ciphertext (`client_secret_enc`) and decrypt it only in-process at exchange
 * time. The key is derived from AAELINK_SSO_SECRET_KEY (falling back to
 * AAELINK_SESSION_SECRET) via SHA-256 so any sufficiently random env secret
 * yields a valid 32-byte key. The secret is never logged.
 *
 * Format: base64(iv[12] || authTag[16] || ciphertext).
 */

function secretKey(): Buffer {
  const raw =
    process.env.AAELINK_SSO_SECRET_KEY?.trim() ||
    process.env.AAELINK_SESSION_SECRET?.trim() ||
    ''
  if (!raw) {
    throw new Error('sso_secret_key_unset')
  }
  return createHash('sha256').update(raw).digest()
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decryptSecret(payload: string): string {
  const buf = Buffer.from(payload, 'base64')
  if (buf.length < 28) throw new Error('sso_secret_malformed')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const enc = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', secretKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}

/** True when a configured-secret env key is present (so the route can 503 early). */
export function ssoSecretKeyConfigured(): boolean {
  return Boolean(
    process.env.AAELINK_SSO_SECRET_KEY?.trim() ||
      process.env.AAELINK_SESSION_SECRET?.trim()
  )
}
