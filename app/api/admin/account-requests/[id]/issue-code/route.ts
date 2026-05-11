import { randomInt } from 'crypto'
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { getAdminSession } from '@/lib/adminAuth'
import { hashPassword } from '@/lib/password'
import { tracedRoute } from '@/lib/tracedRoute'

const OTP_MS = 30 * 60 * 1000

async function _POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()
  const adm = await getAdminSession(pool)
  if (!adm) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await ctx.params
  const rid = String(id || '').trim()
  if (rid.length < 6) return NextResponse.json({ error: 'invalid_id' }, { status: 400 })
  const { rows } = await pool.query<{ status: string }>(
    `SELECT status FROM aaelink.account_requests WHERE id = $1`,
    [rid]
  )
  if (!rows[0]) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (rows[0].status !== 'pending') {
    return NextResponse.json({ error: 'not_pending' }, { status: 409 })
  }
  const plain = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const otp_hash = hashPassword(plain)
  const exp = Date.now() + OTP_MS
  await pool.query(
    `UPDATE aaelink.account_requests SET otp_hash = $1, otp_expires_at = $2 WHERE id = $3`,
    [otp_hash, exp, rid]
  )
  return NextResponse.json({ code: plain, expires_at: exp })
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/admin/account-requests/:id/issue-code', _POST)
