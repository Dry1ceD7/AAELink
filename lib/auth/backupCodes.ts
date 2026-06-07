import { createHmac, timingSafeEqual } from 'crypto'
import type { Pool } from 'pg'

/**
 * D2 Identity — MFA backup (recovery) codes.
 *
 * Enrollment (POST /api/auth/mfa action=generate_backup_codes) generates 10
 * single-use codes and stores them as an HMAC-hashed JSON array in the
 * backup_codes enrollment's `secret_hash`. Nothing consumed them, so a recovery
 * code could never actually clear an MFA gate. This module is the consume side:
 * a backup code is accepted wherever a TOTP code is, burned single-use, and the
 * remaining count is reported back.
 *
 * Hash scheme MUST match the generator exactly (app/api/auth/mfa/route.ts):
 *   createHmac('sha256', 'backup').update(code).digest('hex').slice(0, 16)
 * The stored value is JSON.stringify(codes.map(hashBackupCode)).
 */

const BACKUP_HMAC_KEY = 'backup'
const HASH_LEN = 16

/** HMAC-hash a backup code, matching the enrollment generator byte-for-byte. */
export function hashBackupCode(code: string): string {
  return createHmac('sha256', BACKUP_HMAC_KEY)
    .update(code)
    .digest('hex')
    .slice(0, HASH_LEN)
}

/** Constant-time equality over two fixed-length hex hashes. */
function hashesEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b))
  } catch {
    return false
  }
}

/** Parse a stored backup_codes secret_hash JSON array; tolerant of garbage. */
function parseStoredHashes(secretHash: string): string[] {
  try {
    const parsed = JSON.parse(secretHash) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((h): h is string => typeof h === 'string')
  } catch {
    return []
  }
}

export interface BackupCodeResult {
  consumed: boolean
  /** Codes left on the matched enrollment after a successful burn. */
  remaining: number
}

/**
 * Attempt to consume one of a user's active backup codes.
 *
 * On a match the code is burned single-use atomically: the enrollment row is
 * rewritten with the code's hash removed, guarded by the prior secret_hash value
 * (UPDATE ... WHERE secret_hash = $prev RETURNING). A concurrent attempt with the
 * same code loses the guard race and so cannot reuse it. A code already removed
 * never matches, so reuse is rejected.
 *
 * Returns { consumed:false, remaining:0 } when no active backup code matches.
 */
export async function consumeBackupCode(
  pool: Pool,
  userId: string,
  code: string
): Promise<BackupCodeResult> {
  const candidate = String(code || '').trim().toUpperCase()
  if (!candidate) return { consumed: false, remaining: 0 }
  const target = hashBackupCode(candidate)

  const { rows } = await pool.query<{ id: string; secret_hash: string }>(
    `SELECT id, secret_hash FROM aaelink.mfa_enrollments
      WHERE user_id = $1 AND method = 'backup_codes' AND is_active = true
      ORDER BY created_at DESC`,
    [userId]
  )

  for (const enr of rows) {
    const stored = parseStoredHashes(enr.secret_hash)
    const matchIdx = stored.findIndex((h) => hashesEqual(h, target))
    if (matchIdx === -1) continue

    const next = stored.filter((_, i) => i !== matchIdx)
    const nextJson = JSON.stringify(next)
    const now = Date.now()
    // Atomic single-use burn: the secret_hash guard fails any racing reuse.
    const { rowCount } = await pool.query(
      `UPDATE aaelink.mfa_enrollments
          SET secret_hash = $1, last_used_at = $2
        WHERE id = $3 AND secret_hash = $4
        RETURNING id`,
      [nextJson, now, enr.id, enr.secret_hash]
    )
    if (rowCount && rowCount > 0) {
      return { consumed: true, remaining: next.length }
    }
    // Lost the race (row changed under us): treat as not-consumed; reuse rejected.
    return { consumed: false, remaining: 0 }
  }

  return { consumed: false, remaining: 0 }
}
