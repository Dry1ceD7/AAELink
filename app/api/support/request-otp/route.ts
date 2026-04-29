import { randomBytes, randomInt } from 'crypto'
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { hashPassword } from '@/lib/password'
import { readSessionUserId } from '@/lib/session'
import { sendContactOtpEmail, sendContactOtpSms, contactOtpDeliveryStatus } from '@/lib/sendContactOtp'
import { supportOtpRateLimitHit } from '@/lib/supportOtpRateLimit'

const OTP_MS = 10 * 60 * 1000

function normalizeE164(raw: string): string | null {
  const s = raw.replace(/\s/g, '')
  if (!/^\+?[1-9]\d{6,14}$/.test(s)) return null
  return s.startsWith('+') ? s : `+${s}`
}

function maskEmail(email: string) {
  const [a, d] = email.split('@')
  if (!d) return '***'
  const show = a.slice(0, 2)
  return `${show}***@${d}`
}

export async function POST(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()
  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (supportOtpRateLimitHit(userId)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  let body: { channel?: string; phone?: string }
  try {
    body = (await req.json()) as { channel?: string; phone?: string }
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const channel = String(body.channel || '').toLowerCase()
  if (channel !== 'email' && channel !== 'sms') {
    return NextResponse.json({ error: 'invalid_channel' }, { status: 400 })
  }

  const delivery = contactOtpDeliveryStatus()
  if (channel === 'email' && !delivery.email_ready) {
    return NextResponse.json({ error: 'email_delivery_not_configured' }, { status: 503 })
  }
  if (channel === 'sms' && !delivery.sms_ready) {
    return NextResponse.json({ error: 'sms_not_configured' }, { status: 503 })
  }

  const { rows: urows } = await pool.query<{ email: string }>(`SELECT email FROM aaelink.users WHERE id = $1`, [userId])
  const workEmail = urows[0]?.email?.trim()
  if (!workEmail) return NextResponse.json({ error: 'no_email' }, { status: 400 })

  let destination: string
  if (channel === 'email') {
    destination = workEmail
  } else {
    const phone = normalizeE164(String(body.phone || ''))
    if (!phone) return NextResponse.json({ error: 'invalid_phone' }, { status: 400 })
    destination = phone
  }

  const plain = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const otp_hash = hashPassword(plain)
  const exp = Date.now() + OTP_MS
  const id = randomBytes(16).toString('hex')
  const now = Date.now()

  await pool.query(`DELETE FROM aaelink.support_otp_challenges WHERE user_id = $1`, [userId])
  await pool.query(
    `INSERT INTO aaelink.support_otp_challenges (id, user_id, channel, destination, otp_hash, otp_expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, userId, channel, destination, otp_hash, exp, now]
  )

  if (channel === 'email') {
    const sent = await sendContactOtpEmail(destination, plain)
    if (!sent.ok) {
      await pool.query(`DELETE FROM aaelink.support_otp_challenges WHERE id = $1`, [id])
      return NextResponse.json({ error: sent.error }, { status: 503 })
    }
  } else {
    const sent = await sendContactOtpSms(destination, plain)
    if (!sent.ok) {
      await pool.query(`DELETE FROM aaelink.support_otp_challenges WHERE id = $1`, [id])
      return NextResponse.json({ error: sent.error }, { status: 503 })
    }
  }

  return NextResponse.json({
    challenge_id: id,
    destination_hint: channel === 'email' ? maskEmail(destination) : `${destination.slice(0, 4)}***`
  })
}
