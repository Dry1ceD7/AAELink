import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readMfaPendingSession, clearMfaPending } from '@/lib/auth/session'
import { generateTotpSecret, verifyTotp, otpauthUri } from '@/lib/auth/totp'
import { consumeBackupCode } from '@/lib/auth/backupCodes'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * MFA step-up for SSO logins whose provider has enforce_mfa = true.
 *
 * Such a login leaves the session `mfa_pending = true`, so readSessionUserId
 * treats it as unauthenticated everywhere except here. The user must present a
 * valid TOTP code to clear the gate.
 *
 * POST { action: 'begin' }
 *   - User already has an active TOTP factor → { enrolled: true, code_required }.
 *   - No factor yet → provision a pending TOTP enrollment and return its
 *     { enrollment_id, secret, otpauth_uri } so the user can add it.
 *
 * POST { action: 'verify', code }
 *   - Verify the 6-digit code against the active factor, or against a pending
 *     (just-created) enrollment. On success: activate that enrollment and clear
 *     mfa_pending. The session becomes fully usable.
 *
 * No CSRF: like password login, this completes an auth handshake before the
 * session is usable, so there is no established session to protect yet.
 */
async function _POST(req: Request) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const pending = await readMfaPendingSession()
  if (!pending) return NextResponse.json({ error: 'no_pending_mfa_session' }, { status: 401 })
  const uid = pending.userId

  const body = (await req.json().catch(() => ({}))) as { action?: 'begin' | 'verify'; code?: string }
  const action = body.action === 'begin' ? 'begin' : 'verify'

  // Most-recent active TOTP factor, if any.
  const { rows: active } = await pool.query<{ id: string; secret_hash: string }>(
    `SELECT id, secret_hash FROM aaelink.mfa_enrollments
      WHERE user_id = $1 AND method = 'totp' AND is_active = true
      ORDER BY created_at DESC LIMIT 1`,
    [uid]
  )

  if (action === 'begin') {
    if (active[0]) return NextResponse.json({ enrolled: true, code_required: true })
    // No factor — provision a pending enrollment to step up with.
    const id = randomUUID()
    const secret = generateTotpSecret()
    const now = Date.now()
    await pool.query(
      `INSERT INTO aaelink.mfa_enrollments
         (id, user_id, method, secret_hash, is_active, is_verified, created_at, last_used_at)
       VALUES ($1, $2, 'totp', $3, false, false, $4, 0)`,
      [id, uid, secret, now]
    )
    const { rows: [user] } = await pool.query<{ email: string }>(
      `SELECT email FROM aaelink.users WHERE id = $1`, [uid]
    )
    return NextResponse.json({
      enrolled: false,
      setup: { enrollment_id: id, secret, otpauth_uri: otpauthUri(secret, user?.email || 'user') },
    }, { status: 201 })
  }

  // action === 'verify'
  const code = String(body.code || '').trim()
  if (!code) return NextResponse.json({ error: 'code_required' }, { status: 400 })
  const ip = extractIp(req)
  const userAgent = req.headers.get('user-agent') || ''

  // A 6-digit code is a TOTP attempt; anything else is a backup (recovery) code.
  // Prefer the active TOTP factor; fall back to a pending one from 'begin'.
  if (/^\d{6}$/.test(code)) {
    let enrollment = active[0]
    if (!enrollment) {
      const { rows: pendingEnr } = await pool.query<{ id: string; secret_hash: string }>(
        `SELECT id, secret_hash FROM aaelink.mfa_enrollments
          WHERE user_id = $1 AND method = 'totp' AND is_active = false
          ORDER BY created_at DESC LIMIT 1`,
        [uid]
      )
      enrollment = pendingEnr[0]
    }
    if (enrollment && verifyTotp(enrollment.secret_hash, code)) {
      const now = Date.now()
      await pool.query(
        `UPDATE aaelink.mfa_enrollments SET is_active = true, is_verified = true, last_used_at = $1
          WHERE id = $2 AND user_id = $3`,
        [now, enrollment.id, uid]
      )
      await clearMfaPending(pool, pending.sessionId)
      return NextResponse.json({ ok: true, mfa_verified: true, verified_at: now })
    }
  }

  // Backup code: accepted wherever TOTP is, burned single-use, reuse rejected.
  const burn = await consumeBackupCode(pool, uid, code)
  if (burn.consumed) {
    await clearMfaPending(pool, pending.sessionId)
    try {
      writeAuditLog({
        pool, actorId: uid, action: 'mfa.backup_code_used',
        resourceKind: 'mfa_enrollment', resourceId: uid,
        ipAddress: ip, userAgent, metadata: { remaining: burn.remaining },
      })
    } catch { /* best-effort */ }
    return NextResponse.json({
      ok: true, mfa_verified: true, method: 'backup_code',
      backup_codes_remaining: burn.remaining, verified_at: Date.now(),
    })
  }

  return NextResponse.json({ error: 'invalid_code' }, { status: 400 })
}

export const POST = tracedRoute('POST', '/api/auth/mfa/stepup', _POST)
