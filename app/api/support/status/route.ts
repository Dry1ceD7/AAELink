import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { contactOtpDeliveryStatus } from '@/lib/sendContactOtp'

export async function GET() {
  const pool = getPool()
  let it_online = false
  if (pool) {
    await ensureSchema()
    const { rows } = await pool.query<{ is_online: boolean }>(
      `SELECT is_online FROM aaelink.support_it_presence WHERE id = 'singleton'`
    )
    it_online = Boolean(rows[0]?.is_online)
  }
  const live_chat_url = process.env.NEXT_PUBLIC_AAELINK_IT_LIVE_CHAT_URL?.trim() || ''
  const delivery = contactOtpDeliveryStatus()
  return NextResponse.json({
    it_online,
    live_chat_url,
    it_phone: process.env.NEXT_PUBLIC_AAELINK_IT_PHONE?.trim() || '',
    it_email: process.env.NEXT_PUBLIC_AAELINK_IT_EMAIL?.trim() || '',
    email_otp_ready: delivery.email_ready,
    sms_otp_ready: delivery.sms_ready
  })
}
