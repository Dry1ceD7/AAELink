import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { verifyPassword } from '@/lib/password'

export async function POST(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()
  const body = (await req.json()) as { reference?: string; work_email?: string; code?: string }
  const reference = String(body.reference || '').trim()
  const work_email = String(body.work_email || '').trim().toLowerCase()
  const code = String(body.code || '').trim()
  if (reference.length < 6 || !work_email.includes('@') || code.length < 4) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
  }
  const { rows } = await pool.query<{
    work_email: string
    status: string
    otp_hash: string
    otp_expires_at: string
  }>(
    `SELECT work_email, status, otp_hash, otp_expires_at FROM aaelink.account_requests WHERE id = $1`,
    [reference]
  )
  const row = rows[0]
  if (!row || row.work_email.toLowerCase() !== work_email) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (row.status !== 'pending') {
    return NextResponse.json({ error: 'already_processed' }, { status: 409 })
  }
  const exp = Number(row.otp_expires_at) || 0
  if (!row.otp_hash || exp < Date.now()) {
    return NextResponse.json({ error: 'code_missing_or_expired' }, { status: 400 })
  }
  if (!verifyPassword(code, row.otp_hash)) {
    return NextResponse.json({ error: 'invalid_code' }, { status: 400 })
  }
  const now = Date.now()
  await pool.query(
    `UPDATE aaelink.account_requests SET status = 'verified', otp_hash = '', otp_expires_at = 0, verified_at = $1 WHERE id = $2`,
    [now, reference]
  )
  return NextResponse.json({ ok: true })
}
