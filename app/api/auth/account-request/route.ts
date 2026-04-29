import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { newAccountRequestId } from '@/lib/accountRequestId'

export async function POST(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()
  const body = (await req.json()) as {
    full_name?: string
    work_email?: string
    work_phone?: string
    note?: string
  }
  const full_name = String(body.full_name || '').trim()
  const work_email = String(body.work_email || '').trim().toLowerCase()
  const work_phone = String(body.work_phone || '').trim()
  const note = String(body.note || '').trim().slice(0, 2000)
  if (full_name.length < 2 || !work_email.includes('@') || work_phone.replace(/\D/g, '').length < 8) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
  }
  const id = newAccountRequestId()
  const now = Date.now()
  try {
    await pool.query(
      `INSERT INTO aaelink.account_requests (id, created_at, full_name, work_email, work_phone, note, status, otp_hash, otp_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', '', 0)`,
      [id, now, full_name, work_email, work_phone, note]
    )
  } catch (e: unknown) {
    return NextResponse.json({ error: 'request_failed' }, { status: 400 })
  }
  return NextResponse.json({ reference: id })
}
