import { createHmac, randomBytes } from 'crypto'

/**
 * D2 Identity — RFC 6238 TOTP (and the RFC 4801 HOTP it builds on).
 *
 * Replaces the previous MFA stub that activated an enrollment without checking
 * the code. Secrets are base32 (RFC 4648) so any standard authenticator app
 * (Google Authenticator, Authy, 1Password) interoperates. Default parameters
 * match the de-facto standard: SHA-1, 6 digits, 30-second period.
 *
 * Note: the TOTP secret is a shared secret and must be stored to verify codes.
 * Storing it encrypted at rest is a later hardening step; this module is the
 * algorithm, independent of storage.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Encode bytes as RFC 4648 base32 (no padding). */
export function base32Encode(bytes: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

/** Decode an RFC 4648 base32 string (case-insensitive, ignores spaces/padding). */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/,'').replace(/\s/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** Generate a random base32 TOTP secret (default 20 bytes = 160 bits). */
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes))
}

/** HOTP value for a counter (RFC 4226 dynamic truncation). */
function hotp(secret: Buffer, counter: number, digits: number): string {
  const buf = Buffer.alloc(8)
  // 64-bit big-endian counter (safe for the 53-bit range we use).
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
  buf.writeUInt32BE(counter >>> 0, 4)
  const hmac = createHmac('sha1', secret).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return (bin % 10 ** digits).toString().padStart(digits, '0')
}

export interface TotpOptions {
  digits?: number
  period?: number
  /** Absolute time in ms (defaults to now). */
  timeMs?: number
}

/** Current TOTP code for a base32 secret. */
export function totpCode(secretBase32: string, opts: TotpOptions = {}): string {
  const digits = opts.digits ?? 6
  const period = opts.period ?? 30
  const timeMs = opts.timeMs ?? Date.now()
  const counter = Math.floor(timeMs / 1000 / period)
  return hotp(base32Decode(secretBase32), counter, digits)
}

/**
 * Verify a TOTP code against a secret, tolerating clock drift of `window` steps
 * on each side (default ±1 step = ±30s). Constant-ish: checks each candidate.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  opts: TotpOptions & { window?: number } = {}
): boolean {
  const digits = opts.digits ?? 6
  const period = opts.period ?? 30
  const window = opts.window ?? 1
  const timeMs = opts.timeMs ?? Date.now()
  const normalized = String(code).trim()
  if (!/^\d+$/.test(normalized) || normalized.length !== digits) return false

  const secret = base32Decode(secretBase32)
  const baseCounter = Math.floor(timeMs / 1000 / period)
  for (let drift = -window; drift <= window; drift++) {
    if (hotp(secret, baseCounter + drift, digits) === normalized) return true
  }
  return false
}

/** Build the otpauth:// provisioning URI an authenticator app scans. */
export function otpauthUri(secretBase32: string, account: string, issuer = 'AAELink'): string {
  const label = encodeURIComponent(`${issuer}:${account}`)
  const params = new URLSearchParams({ secret: secretBase32, issuer, digits: '6', period: '30', algorithm: 'SHA1' })
  return `otpauth://totp/${label}?${params.toString()}`
}
