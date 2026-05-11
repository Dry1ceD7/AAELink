'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, MessageCircle, Phone, Mail } from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'

type SupportStatus = {
  it_online: boolean
  live_chat_url: string
  it_phone: string
  it_email: string
  email_otp_ready: boolean
  sms_otp_ready: boolean
}

type Step = 'intro' | 'otp' | 'unlocked'

export function EmergencyContactPanel() {
  const [status, setStatus] = useState<SupportStatus | null>(null)
  const [sessionVerified, setSessionVerified] = useState(false)
  const [step, setStep] = useState<Step>('intro')
  const [channel, setChannel] = useState<'email' | 'sms'>('email')
  const [smsPhone, setSmsPhone] = useState('')
  const [challengeId, setChallengeId] = useState('')
  const [hint, setHint] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [emergencyText, setEmergencyText] = useState('')
  const [sentOk, setSentOk] = useState(false)
  const [queueSuccess, setQueueSuccess] = useState('')

  const load = useCallback(async () => {
    setErr('')
    const [r1, r2] = await Promise.all([apiFetch('/api/support/status'), apiFetch('/api/support/session')])
    if (r1.ok) {
      const j = (await r1.json()) as SupportStatus
      setStatus(j)
    }
    if (r2.ok) {
      const j = (await r2.json()) as { verified?: boolean }
      const v = Boolean(j.verified)
      setSessionVerified(v)
      setStep(cur => (cur === 'otp' ? cur : v ? 'unlocked' : 'intro'))
    }
  }, [])

  const pollStatusOnly = useCallback(async () => {
    const r1 = await apiFetch('/api/support/status')
    if (r1.ok) {
      const j = (await r1.json()) as SupportStatus
      setStatus(j)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const id = window.setInterval(() => void pollStatusOnly(), 25_000)
    return () => window.clearInterval(id)
  }, [pollStatusOnly])

  async function requestOtp() {
    setBusy(true)
    setErr('')
    setSentOk(false)
    const res = await apiFetch('/api/support/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        channel === 'sms' ? { channel: 'sms', phone: smsPhone.trim() } : { channel: 'email' }
      )
    })
    setBusy(false)
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (res.status === 429) setErr('Too many requests. Wait about 15 minutes and try again.')
      else if (j.error === 'email_delivery_not_configured')
        setErr('Email verification is not available on this server. Ask IT to enable outbound mail for codes.')
      else if (j.error === 'sms_not_configured') setErr('SMS is not configured. Use email or ask IT to add Twilio credentials.')
      else if (j.error === 'invalid_phone') setErr('Enter a valid international number with country code (for example +66812345678).')
      else setErr('Could not send a code. Try again or pick the other channel.')
      return
    }
    const data = (await res.json()) as { challenge_id?: string; destination_hint?: string }
    if (data.challenge_id) setChallengeId(data.challenge_id)
    setHint(data.destination_hint || '')
    setStep('otp')
    setSentOk(true)
  }

  async function verifyOtp() {
    setBusy(true)
    setErr('')
    const res = await apiFetch('/api/support/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge_id: challengeId, code: otpCode.replace(/\D/g, '') })
    })
    setBusy(false)
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (j.error === 'expired') setErr('That code expired. Request a new one.')
      else if (j.error === 'wrong_code') setErr('That code is not correct.')
      else setErr('Verification failed.')
      return
    }
    setSessionVerified(true)
    setStep('unlocked')
    setOtpCode('')
  }

  async function submitEmergency() {
    setBusy(true)
    setErr('')
    const res = await apiFetch('/api/support/emergency', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: emergencyText.trim() })
    })
    setBusy(false)
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (j.error === 'support_verification_required') setErr('Confirm the code first.')
      else if (j.error === 'message_too_short') setErr('Write at least 10 characters so IT can act on it.')
      else setErr('Could not send the message.')
      return
    }
    setEmergencyText('')
    setErr('')
    setQueueSuccess('Your message was delivered to the IT queue.')
    setTimeout(() => setQueueSuccess(''), 8000)
  }

  async function clearVerification() {
    await apiFetch('/api/support/session', { method: 'DELETE' })
    setSessionVerified(false)
    setStep('intro')
    setChallengeId('')
    setOtpCode('')
    void load()
  }

  if (!status) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8 }}>
        <Loader2 size={20} className="spin" aria-hidden="true" />
        <span>Loading</span>
      </div>
    )
  }

  const liveChatAllowed = sessionVerified && status.it_online && Boolean(status.live_chat_url)

  return (
    <div className="mm-emergency-panel" style={{ maxWidth: 520 }}>
      <p
        className="aae-auth-lead"
        style={{
          margin: '0 0 12px',
          padding: '8px 10px',
          borderRadius: 8,
          background: status.it_online ? 'rgba(0, 135, 90, 0.08)' : 'rgba(0,0,0,0.06)',
          fontSize: 14
        }}
      >
        {status.it_online ? (
          <span>IT desk is online. Live chat is available after you verify below.</span>
        ) : (
          <span>IT desk is offline. You can still call or email published contacts, or leave an urgent written message after verification.</span>
        )}
      </p>

      {err ? <p className="form-error" style={{ marginBottom: 10 }}>{err}</p> : null}
      {queueSuccess ? (
        <p style={{ marginBottom: 10, fontSize: 14, color: 'var(--mm-muted, #333)' }} role="status">
          {queueSuccess}
        </p>
      ) : null}

      {step === 'intro' ? (
        <section style={{ marginBottom: 16 }}>
          <p className="aae-auth-lead" style={{ marginBottom: 10, fontSize: 14 }}>
            Choose how you want to receive a one-time code. You must verify before live chat or sending an in-app urgent message.
          </p>
          {!status.email_otp_ready && !status.sms_otp_ready ? (
            <p className="form-error" style={{ fontSize: 14 }}>
              Verification codes cannot be sent from this server yet. Ask your IT administrator to complete email or SMS setup.
            </p>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
                <label className="mm-pref-check" style={{ cursor: status.email_otp_ready ? 'pointer' : 'not-allowed', opacity: status.email_otp_ready ? 1 : 0.5 }}>
                  <input
                    type="radio"
                    name="otp-ch"
                    checked={channel === 'email'}
                    disabled={!status.email_otp_ready}
                    onChange={() => setChannel('email')}
                  />
                  <span>Email (to your account work email)</span>
                </label>
                <label className="mm-pref-check" style={{ cursor: status.sms_otp_ready ? 'pointer' : 'not-allowed', opacity: status.sms_otp_ready ? 1 : 0.5 }}>
                  <input
                    type="radio"
                    name="otp-ch"
                    checked={channel === 'sms'}
                    disabled={!status.sms_otp_ready}
                    onChange={() => setChannel('sms')}
                  />
                  <span>SMS (international number with country code)</span>
                </label>
              </div>
              {channel === 'sms' ? (
                <label className="field-label" style={{ display: 'block', marginBottom: 12 }}>
                  Mobile number
                  <input
                    className="slack-input"
                    type="tel"
                    autoComplete="tel"
                    placeholder="+66812345678"
                    value={smsPhone}
                    onChange={e => setSmsPhone(e.target.value)}
                  />
                </label>
              ) : null}
              <button type="button" className="slack-button" disabled={busy} onClick={() => void requestOtp()}>
                {busy ? 'Sending' : 'Send code'}
              </button>
            </>
          )}
        </section>
      ) : null}

      {step === 'otp' ? (
        <section style={{ marginBottom: 16 }}>
          <p className="aae-auth-lead" style={{ marginBottom: 8, fontSize: 14 }}>
            {sentOk ? `Code sent (${hint}).` : null} Enter the 6-digit code.
          </p>
          <label className="field-label">
            Code
            <input
              className="slack-input"
              inputMode="numeric"
              maxLength={8}
              value={otpCode}
              onChange={e => setOtpCode(e.target.value)}
              autoComplete="one-time-code"
            />
          </label>
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button type="button" className="slack-button" disabled={busy} onClick={() => void verifyOtp()}>
              {busy ? 'Checking' : 'Verify'}
            </button>
            <button type="button" className="ghost-button" disabled={busy} onClick={() => void requestOtp()}>
              Resend code
            </button>
            <button type="button" className="ghost-button" onClick={() => setStep('intro')}>
              Back
            </button>
          </div>
        </section>
      ) : null}

      {step === 'unlocked' ? (
        <section>
          <p className="aae-auth-lead" style={{ marginBottom: 12, fontSize: 14, color: 'var(--mm-muted, #555)' }}>
            You are verified for this browser session. Sign out clears verification.
          </p>
          <ul style={{ margin: '0 0 14px', paddingLeft: 20, fontSize: 14, lineHeight: 1.65 }}>
            {status.it_phone ? (
              <li>
                <Phone size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} aria-hidden="true" />
                <a href={`tel:${status.it_phone.replace(/\s/g, '')}`} className="link-button">
                  {status.it_phone}
                </a>
              </li>
            ) : (
              <li>Phone: see your internal IT directory.</li>
            )}
            {status.it_email ? (
              <li>
                <Mail size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} aria-hidden="true" />
                <a href={`mailto:${status.it_email}`} className="link-button">
                  {status.it_email}
                </a>
              </li>
            ) : null}
            <li>
              <MessageCircle size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} aria-hidden="true" />
              Live chat:{' '}
              {liveChatAllowed ? (
                <a href={status.live_chat_url} target="_blank" rel="noopener noreferrer" className="link-button">
                  Open live chat
                </a>
              ) : status.live_chat_url ? (
                <span className="doc-muted">Unavailable until IT is online.</span>
              ) : (
                <span className="doc-muted">Not configured for this deployment.</span>
              )}
            </li>
          </ul>

          <h3 className="aae-auth-title" style={{ fontSize: 15, marginBottom: 6 }}>
            Urgent message to IT
          </h3>
          <textarea
            className="slack-input"
            rows={4}
            style={{ width: '100%', resize: 'vertical' }}
            placeholder="Describe the issue (at least 10 characters)."
            value={emergencyText}
            onChange={e => setEmergencyText(e.target.value)}
          />
          <button type="button" className="slack-button" style={{ marginTop: 8 }} disabled={busy} onClick={() => void submitEmergency()}>
            {busy ? 'Sending' : 'Send to IT queue'}
          </button>

          <div style={{ marginTop: 16 }}>
            <button type="button" className="ghost-button" onClick={() => void clearVerification()}>
              Clear verification on this device
            </button>
          </div>
        </section>
      ) : null}
    </div>
  )
}
