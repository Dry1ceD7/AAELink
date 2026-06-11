import { randomBytes } from 'crypto'

/** Short public reference for access requests (shown to end users and IT). */
export function newAccountRequestId(): string {
  return randomBytes(6).toString('hex').slice(0, 12)
}
