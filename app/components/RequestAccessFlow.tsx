'use client'

import Image from 'next/image'
import Link from 'next/link'
import { AlertCircle } from 'lucide-react'
import { useMemo, useState } from 'react'

const phone = process.env.NEXT_PUBLIC_AAELINK_IT_PHONE?.trim() || ''
const email = process.env.NEXT_PUBLIC_AAELINK_IT_EMAIL?.trim() || ''
const liveChat = process.env.NEXT_PUBLIC_AAELINK_IT_LIVE_CHAT_URL?.trim() || ''

export type RequestAccessLayout = 'page' | 'modal'

export type RequestAccessFlowProps = {
  layout: RequestAccessLayout
  /** Called after successful IT code verification when `layout` is `modal`. */
  onVerified?: () => void
  onClose?: () => void
}

export function RequestAccessFlow({ layout, onVerified, onClose }: RequestAccessFlowProps) {
  const [step, setStep] = useState<1 | 2>(1)
  const [fullName, setFullName] = useState('')
  const [workEmail, setWorkEmail] = useState('')
  const [workPhone, setWorkPhone] = useState('')
  const [note, setNote] = useState('')
  const [reference, setReference] = useState('')
  const [verifyEmail, setVerifyEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const contactBlock = useMemo(
    () => (
      <div className="aae-it-contact" style={{ marginTop: 14 }}>
        <p className="aae-auth-lead" style={{ marginBottom: 8, fontWeight: 600 }}>
          IT emergency and access
        </p>
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--mm-muted, #555)', fontSize: 14, lineHeight: 1.55 }}>
          {phone ? (
            <li>
              Phone:{' '}
              <a href={`tel:${phone.replace(/\s/g, '')}`} className="link-button" style={{ fontWeight: 600 }}>
                {phone}
              </a>
            </li>
          ) : (
            <li>Phone: your administrator will publish the support number in your organization handbook.</li>
          )}
          {email ? (
            <li>
              Email:{' '}
              <a href={`mailto:${email}`} className="link-button" style={{ fontWeight: 600 }}>
                {email}
              </a>
            </li>
          ) : (
            <li>Email: use your internal directory for the IT service desk address.</li>
          )}
          {liveChat ? (
            <li>
              Live chat:{' '}
              <a href={liveChat} target="_blank" rel="noopener noreferrer" className="link-button" style={{ fontWeight: 600 }}>
                Open chat
              </a>
            </li>
          ) : (
            <li>Live chat: open your company Teams or chat link from IT.</li>
          )}
        </ul>
      </div>
    ),
    []
  )

  async function submitRequest(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/auth/account-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: fullName.trim(),
        work_email: workEmail.trim(),
        work_phone: workPhone.trim(),
        note: note.trim()
      })
    })
    setLoading(false)
    if (!res.ok) {
      setError('Check your name, work email, and a phone number with at least 8 digits.')
      return
    }
    const data = (await res.json()) as { reference?: string }
    if (!data.reference) {
      setError('Could not submit request. Try again later.')
      return
    }
    setReference(data.reference)
    setVerifyEmail(workEmail.trim().toLowerCase())
    setStep(2)
  }

  async function submitVerify(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/auth/verify-account-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reference: reference.trim(),
        work_email: verifyEmail.trim().toLowerCase(),
        code: code.trim()
      })
    })
    setLoading(false)
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (j.error === 'invalid_code') setError('That code does not match. Ask IT for a new code if it expired.')
      else if (j.error === 'code_missing_or_expired') setError('This code has expired. Ask IT to send a new one.')
      else setError('Could not verify. Check your reference number and email.')
      return
    }
    setStep(1)
    setReference('')
    setCode('')
    setError('')
    if (layout === 'modal' && onVerified) {
      onVerified()
      onClose?.()
      return
    }
    window.location.href = '/login?verified=1'
  }

  const titleId = 'aae-request-access-title'

  return (
    <>
      {layout === 'page' ? (
        <div className="aae-auth-brand">
          <Image
            src="/brand/aae-logo.png"
            alt=""
            width={180}
            height={180}
            priority
            className="aae-auth-logo"
          />
          <p className="aae-auth-company">Advanced ID Asia Engineering Co., Ltd</p>
          <p className="aae-auth-product">AAELink</p>
        </div>
      ) : (
        <div className="aae-auth-brand aae-auth-brand--modal">
          <Image src="/brand/aae-logo.png" alt="" width={120} height={120} className="aae-auth-logo" />
          <p className="aae-auth-product" style={{ marginTop: 8 }}>
            AAELink
          </p>
        </div>
      )}
      <h1 className="aae-auth-title" id={titleId}>
        {step === 1 ? 'Request access' : 'Confirm with IT code'}
      </h1>
      <p className="aae-auth-lead">
        AAELink is for authorized staff only. User names and passwords are created by IT after your request is approved.
      </p>
      {contactBlock}
      {step === 1 ? (
        <form onSubmit={submitRequest} style={{ marginTop: 22 }}>
          <label className="field-label" htmlFor="aae-ra-fullname">
            Full name
            <input
              id="aae-ra-fullname"
              className="slack-input"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              required
              autoComplete="name"
            />
          </label>
          <label className="field-label" htmlFor="aae-ra-email" style={{ marginTop: 10 }}>
            Work email
            <input
              id="aae-ra-email"
              className="slack-input"
              type="email"
              value={workEmail}
              onChange={e => setWorkEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label className="field-label" htmlFor="aae-ra-phone" style={{ marginTop: 10 }}>
            Work phone
            <input
              id="aae-ra-phone"
              className="slack-input"
              type="tel"
              value={workPhone}
              onChange={e => setWorkPhone(e.target.value)}
              required
              autoComplete="tel"
            />
          </label>
          <label className="field-label" htmlFor="aae-ra-note" style={{ marginTop: 10 }}>
            Message (optional)
            <textarea id="aae-ra-note" className="slack-input" rows={3} value={note} onChange={e => setNote(e.target.value)} />
          </label>
          {error ? (
            <div className="mm-auth-alert mm-auth-alert--error" role="alert" style={{ marginTop: 12 }}>
              <AlertCircle size={18} strokeWidth={2} aria-hidden />
              <span>{error}</span>
            </div>
          ) : null}
          <p className="aae-auth-lead" style={{ marginTop: 14, fontSize: 13 }}>
            After you submit, contact IT using the options above. They will give you a one-time code. Enter it on the next screen to confirm this request.
          </p>
          <button className="slack-button mm-auth-submit" style={{ width: '100%', marginTop: 16 }} type="submit" disabled={loading}>
            {loading ? 'Sending…' : 'Submit request'}
          </button>
        </form>
      ) : (
        <form onSubmit={submitVerify} style={{ marginTop: 22 }}>
          <p className="aae-auth-lead" style={{ fontSize: 14 }}>
            Your reference number: <strong>{reference}</strong>. Tell IT this number if they ask.
          </p>
          <label className="field-label" htmlFor="aae-ra-verify-email" style={{ marginTop: 12 }}>
            Work email
            <input
              id="aae-ra-verify-email"
              className="slack-input"
              type="email"
              value={verifyEmail}
              onChange={e => setVerifyEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label className="field-label" htmlFor="aae-ra-code" style={{ marginTop: 10 }}>
            Code from IT
            <input
              id="aae-ra-code"
              className="slack-input"
              inputMode="numeric"
              value={code}
              onChange={e => setCode(e.target.value)}
              required
              autoComplete="one-time-code"
            />
          </label>
          {error ? (
            <div className="mm-auth-alert mm-auth-alert--error" role="alert" style={{ marginTop: 12 }}>
              <AlertCircle size={18} strokeWidth={2} aria-hidden />
              <span>{error}</span>
            </div>
          ) : null}
          <button className="slack-button mm-auth-submit" style={{ width: '100%', marginTop: 16 }} type="submit" disabled={loading}>
            {loading ? 'Checking…' : 'Confirm'}
          </button>
          <button type="button" className="ghost-button" style={{ width: '100%', marginTop: 10 }} onClick={() => setStep(1)}>
            Back
          </button>
        </form>
      )}
      {layout === 'page' ? (
        <p className="aae-auth-footer" style={{ marginTop: 20 }}>
          <Link href="/login">Back to sign in</Link>
        </p>
      ) : (
        <p className="aae-auth-footer" style={{ marginTop: 20 }}>
          <button type="button" className="link-button" style={{ fontWeight: 700, background: 'none', border: 0, cursor: 'pointer', padding: 0, font: 'inherit' }} onClick={() => onClose?.()}>
            Close and return to sign in
          </button>
        </p>
      )}
    </>
  )
}
