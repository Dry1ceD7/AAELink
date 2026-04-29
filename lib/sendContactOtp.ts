/**
 * Outbound one-time codes for IT contact verification (Resend email, Twilio SMS).
 */

function resendConfigured(): boolean {
  return Boolean(process.env.AAELINK_RESEND_API_KEY?.trim() && process.env.AAELINK_RESEND_FROM?.trim())
}

function twilioConfigured(): boolean {
  return Boolean(
    process.env.AAELINK_TWILIO_ACCOUNT_SID?.trim() &&
    process.env.AAELINK_TWILIO_AUTH_TOKEN?.trim() &&
    process.env.AAELINK_TWILIO_FROM?.trim()
  )
}

export function contactOtpDeliveryStatus() {
  return {
    email_ready: resendConfigured() || process.env.AAELINK_OTP_LOG_TO_STDOUT === '1',
    sms_ready: twilioConfigured()
  }
}

export async function sendContactOtpEmail(to: string, code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const logDev = process.env.AAELINK_OTP_LOG_TO_STDOUT === '1'
  const key = process.env.AAELINK_RESEND_API_KEY?.trim()
  const from = process.env.AAELINK_RESEND_FROM?.trim()
  if (!key || !from) {
    if (logDev) {
      console.info(`[AAELink contact OTP] to=${to} code=${code}`)
      return { ok: true }
    }
    return { ok: false, error: 'email_delivery_not_configured' }
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Your AAELink verification code',
      text: `Your verification code is: ${code}\n\nIt expires in 10 minutes. If you did not request this, ignore this message.`
    })
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    console.error('[AAELink Resend]', res.status, t)
    return { ok: false, error: 'email_send_failed' }
  }
  return { ok: true }
}

export async function sendContactOtpSms(toE164: string, code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!twilioConfigured()) {
    return { ok: false, error: 'sms_not_configured' }
  }
  const sid = process.env.AAELINK_TWILIO_ACCOUNT_SID!.trim()
  const token = process.env.AAELINK_TWILIO_AUTH_TOKEN!.trim()
  const from = process.env.AAELINK_TWILIO_FROM!.trim()
  const auth = Buffer.from(`${sid}:${token}`).toString('base64')
  const body = new URLSearchParams({
    To: toE164,
    From: from,
    Body: `Your AAELink verification code is ${code}. Expires in 10 minutes.`
  })
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    console.error('[AAELink Twilio]', res.status, t)
    return { ok: false, error: 'sms_send_failed' }
  }
  return { ok: true }
}
