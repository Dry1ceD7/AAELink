import { NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { verifyPassword } from '@/lib/auth/password'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import {
  createSupportContactSession,
  setSupportSessionCookie
} from '@/lib/auth/supportSession'

async function _POST(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()
  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { challenge_id?: string; code?: string }
  try {
    body = (await req.json()) as { challenge_id?: string; code?: string }
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const challengeId = String(body.challenge_id || '').trim()
  const code = String(body.code || '').replace(/\D/g, '').slice(0, 8)
  if (challengeId.length < 16 || code.length !== 6) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
  }

  const { rows } = await pool.query<{
    user_id: string
    otp_hash: string
    otp_expires_at: string | number
  }>(
    `SELECT user_id, otp_hash, otp_expires_at FROM aaelink.support_otp_challenges WHERE id = $1`,
    [challengeId]
  )
  const row = rows[0]
  if (!row || row.user_id !== userId) {
    return NextResponse.json({ error: 'invalid_challenge' }, { status: 400 })
  }
  const exp = Number(row.otp_expires_at)
  if (!Number.isFinite(exp) || Date.now() > exp) {
    await pool.query(`DELETE FROM aaelink.support_otp_challenges WHERE id = $1`, [challengeId])
    return NextResponse.json({ error: 'expired' }, { status: 410 })
  }
  if (!verifyPassword(code, row.otp_hash)) {
    return NextResponse.json({ error: 'wrong_code' }, { status: 400 })
  }

  await pool.query(`DELETE FROM aaelink.support_otp_challenges WHERE id = $1`, [challengeId])
  const sessionId = await createSupportContactSession(userId)
  const res = NextResponse.json({ ok: true })
  setSupportSessionCookie(res, sessionId)
  return res
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/support/verify-otp', _POST)
