import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'

const KEYLEN = 64

/** Format: scrypt$<saltHex>$<hashHex> */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(plain, salt, KEYLEN).toString('hex')
  return `scrypt$${salt}$${hash}`
}

export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const [, salt, hashHex] = parts
  if (!salt || !hashHex) return false
  try {
    const derived = scryptSync(plain, salt, KEYLEN)
    const target = Buffer.from(hashHex, 'hex')
    if (derived.length !== target.length) return false
    return timingSafeEqual(derived, target)
  } catch {
    return false
  }
}
