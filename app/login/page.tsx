'use client'

import Image from 'next/image'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Eye, EyeOff, Loader2, ShieldCheck, X } from 'lucide-react'

import { RequestAccessFlow } from '@/components/modals/RequestAccessFlow'
import { MfaStepUp } from '@/components/auth/MfaStepUp'

const phone = process.env.NEXT_PUBLIC_AAELINK_IT_PHONE?.trim() || ''
const email = process.env.NEXT_PUBLIC_AAELINK_IT_EMAIL?.trim() || ''
const liveChat = process.env.NEXT_PUBLIC_AAELINK_IT_LIVE_CHAT_URL?.trim() || ''

export default function LoginPage() {
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [banner, setBanner] = useState('')
  const [mfaStepUp, setMfaStepUp] = useState(false)
  const [requestOpen, setRequestOpen] = useState(false)
  const [requestKey, setRequestKey] = useState(0)
  const [conn, setConn] = useState<{ host: string; secure: boolean } | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [mounted, setMounted] = useState(false)
  const closeBtnRef = useRef<HTMLButtonElement>(null)
  const requestPanelRef = useRef<HTMLDivElement>(null)
  const priorFocusBeforeRequestRef = useRef<HTMLElement | null>(null)

  // ── Splash → fade-in ──────────────────────────────────────────────────
  useEffect(() => {
    // Avoid requestAnimationFrame which can get cancelled or stalled in Electron
    const id = setTimeout(() => setMounted(true), 10)
    return () => clearTimeout(id)
  }, [])

  const itHelp = useMemo(
    () => (
      <div className="mm-login-it-help">
        <p className="mm-login-it-help-title">IT &amp; emergency access</p>
        <ul className="mm-login-it-help-list">
          {phone ? (
            <li>
              Phone:{' '}
              <a href={`tel:${phone.replace(/\s/g, '')}`} className="link-button">
                {phone}
              </a>
            </li>
          ) : (
            <li>Phone: use your internal directory for the IT service desk.</li>
          )}
          {email ? (
            <li>
              Email:{' '}
              <a href={`mailto:${email}`} className="link-button">
                {email}
              </a>
            </li>
          ) : null}
          {liveChat ? (
            <li>
              Live chat:{' '}
              <a href={liveChat} target="_blank" rel="noopener noreferrer" className="link-button">
                Open chat
              </a>
            </li>
          ) : null}
        </ul>
      </div>
    ),
    []
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    setConn({ host: window.location.host, secure: window.location.protocol === 'https:' })
    const q = new URLSearchParams(window.location.search)
    if (q.get('registered') === '1') setBanner('Account created. Sign in below.')
    if (q.get('verified') === '1') setBanner('Your access request was confirmed. When IT creates your sign-in, use it here.')
    
    // SSO handling.
    // The hardened inbound-SSO flow (ADR 0014) funnels ALL auth failures through
    // a single generic ?error=sso_failed redirect (no failure-mode oracle), and
    // signals a successful-but-MFA-gated login via ?mfa=stepup. The remaining
    // codes below are retained for any legacy/bookmarked links still in flight.
    const err = q.get('error')
    if (err === 'sso_disabled') setError('SSO is currently disabled. Please sign in with email/password.')
    else if (err === 'sso_failed') setError('SSO authentication failed. Please try again.')
    else if (err === 'sso_profile_failed') setError('Failed to retrieve user profile from identity provider.')
    else if (err === 'sso_error') setError('An unexpected SSO error occurred.')

    // A provider with enforce_mfa=true leaves the session mfa_pending and lands
    // the user here. Render the actual step-up control (TOTP / passkey) instead
    // of a dead-end banner — re-submitting the password form would start an
    // unrelated local-credential login.
    if (q.get('mfa') === 'stepup') setMfaStepUp(true)
  }, [])

  useEffect(() => {
    if (!requestOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = window.setTimeout(() => closeBtnRef.current?.focus(), 0)
    return () => {
      window.clearTimeout(t)
      document.body.style.overflow = prev
    }
  }, [requestOpen])

  useEffect(() => {
    if (!requestOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setRequestOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [requestOpen])

  useLayoutEffect(() => {
    if (requestOpen) return
    const el = priorFocusBeforeRequestRef.current
    priorFocusBeforeRequestRef.current = null
    if (!el || !document.contains(el)) return
    try {
      el.focus({ preventScroll: true })
    } catch {
      /* ignore */
    }
  }, [requestOpen])

  useEffect(() => {
    const panel = requestPanelRef.current
    if (!panel || !requestOpen) return

    const focusables = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter(el => el.offsetParent !== null || el === document.activeElement)

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const active = document.activeElement
      if (!active || !panel.contains(active)) return
      const nodes = focusables()
      if (nodes.length === 0) return
      if (nodes.length === 1) {
        e.preventDefault()
        nodes[0].focus()
        return
      }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (e.shiftKey) {
        if (active === first) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [requestOpen])

  const openRequestAccess = useCallback(() => {
    const a = document.activeElement
    priorFocusBeforeRequestRef.current = a instanceof HTMLElement ? a : null
    setRequestKey(k => k + 1)
    setRequestOpen(true)
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ login_id: loginId.trim(), password })
    })
    setLoading(false)
    if (!res.ok) {
      let j: { error?: string } = {}
      try {
        j = (await res.json()) as { error?: string }
      } catch {
        /* ignore */
      }
      if (res.status === 503) {
        if (j.error === 'database_not_configured') {
          setError('Sign-in is not available on this server yet. Contact your IT administrator.')
          return
        }
        if (j.error === 'database_unavailable') {
          setError('The service is temporarily unavailable. Try again shortly or contact IT.')
          return
        }
        setError('Sign-in is temporarily unavailable. Try again in a few minutes or contact IT.')
        return
      }
      if (res.status === 500 && j.error === 'server_error') {
        setError('Sign-in failed. Try again or contact IT.')
        return
      }
      if (j.error === 'invalid_credentials') {
        setError('Wrong email, user name, or password.')
        return
      }
      setError('Sign-in failed.')
      return
    }
    // Expired password (admin rotation policy): session is established, but send
    // the user straight into Preferences (?prefs=1 opens the modal) to change it.
    const okBody = (await res.json().catch(() => ({}))) as { password_expired?: boolean }
    // Full navigation so the browser reliably applies Set-Cookie before loading /workspaces (avoids soft-nav races).
    window.location.assign(okBody.password_expired ? '/home?prefs=1' : '/workspaces')
  }

  const serverLine = conn ? `${conn.secure ? 'https' : 'http'}://${conn.host}` : ''

  return (
    <>
      <main className={`mm-login-shell${mounted ? ' mm-login-shell--ready' : ''}`} inert={requestOpen ? true : undefined}>
        {/* ── Left: brand panel ──────────────────────────────────────── */}
        <div className="mm-login-brand">
          <div className="mm-login-brand-inner">
            <Image
              src="/brand/aae-logo.png"
              alt=""
              width={200}
              height={200}
              priority
              className="mm-login-brand-logo"
            />
            <h1 className="mm-login-brand-name">AAELink</h1>
            <p className="mm-login-brand-company">
              Advanced ID Asia Engineering Co., Ltd
            </p>
            <p className="mm-login-brand-tagline">
              Secure enterprise collaboration for your entire organization
            </p>
          </div>
          <p className="mm-login-brand-footer">
            © {new Date().getFullYear()} Advanced ID Asia Engineering
          </p>
        </div>

        {/* ── Right: auth form ───────────────────────────────────────── */}
        <div className="mm-login-form-panel">
          <div className="mm-login-form-scroll">
            <div className="mm-login-form-wrap">
              {/* Mobile-only compact brand */}
              <div className="mm-login-mobile-brand">
                <Image
                  src="/brand/aae-logo.png"
                  alt=""
                  width={80}
                  height={80}
                  priority
                  className="mm-login-mobile-logo"
                />
                <div>
                  <p className="mm-login-mobile-name">AAELink</p>
                  <p className="mm-login-mobile-co">Advanced ID Asia Engineering</p>
                </div>
              </div>

              <h2 className="mm-login-title">
                {mfaStepUp ? 'Verify it’s you' : 'Sign in to your account'}
              </h2>
              <p className="mm-login-subtitle">
                {mfaStepUp
                  ? 'One more step to finish signing in.'
                  : 'Use the email or user name and password issued by your IT team.'}
              </p>

              {mfaStepUp ? (
                <MfaStepUp onComplete={() => window.location.assign('/home')} />
              ) : (
              <>
              {conn ? (
                <div className="mm-login-server-info" aria-label="Connection">
                  {serverLine ? (
                    <div className="mm-login-server-row">
                      <strong>Server</strong>
                      <span>{serverLine}</span>
                    </div>
                  ) : null}
                  {conn.secure ? (
                    <div className="mm-login-server-row mm-login-server-row--secure">
                      <ShieldCheck size={15} strokeWidth={2} aria-hidden />
                      <span>Secure connection (HTTPS)</span>
                    </div>
                  ) : (
                    <div className="mm-login-server-row mm-login-server-row--warn">
                      <strong>Notice</strong>
                      <span>Not using HTTPS. Avoid entering your password on untrusted networks.</span>
                    </div>
                  )}
                </div>
              ) : null}

              {banner ? <p className="mm-login-banner">{banner}</p> : null}

              <form className="mm-login-form" onSubmit={submit}>
                <label className="mm-login-label" htmlFor="aae-login-id">
                  Email or user name
                </label>
                <input
                  id="aae-login-id"
                  className="mm-login-input"
                  value={loginId}
                  onChange={e => setLoginId(e.target.value)}
                  autoComplete="username"
                  autoFocus
                  required
                  placeholder="you@company.com"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'aae-login-error' : undefined}
                />

                <label className="mm-login-label" htmlFor="aae-login-password">
                  Password
                </label>
                <div className="mm-login-password-wrap">
                  <input
                    id="aae-login-password"
                    className="mm-login-input"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                    placeholder="••••••••"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? 'aae-login-error' : undefined}
                  />
                  <button
                    type="button"
                    className="mm-login-password-toggle"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword(s => !s)}
                  >
                    {showPassword ? <EyeOff size={18} strokeWidth={2} aria-hidden /> : <Eye size={18} strokeWidth={2} aria-hidden />}
                  </button>
                </div>

                <div className="mm-login-forgot-row">
                  {email ? (
                    <a
                      href={`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent('AAELink password assistance')}`}
                      className="mm-login-forgot-link"
                    >
                      Forgot your password?
                    </a>
                  ) : (
                    <span className="mm-login-forgot-text">Forgot your password? Contact IT.</span>
                  )}
                </div>

                {error ? (
                  <div id="aae-login-error" className="mm-login-error" role="alert">
                    <AlertCircle size={18} strokeWidth={2} aria-hidden />
                    <span>{error}</span>
                  </div>
                ) : null}

                <button className="mm-login-submit" type="submit" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 size={18} className="spin" aria-hidden />
                      Signing in…
                    </>
                  ) : (
                    'Sign in'
                  )}
                </button>
              </form>

              <div className="mm-login-divider">
                <span>or</span>
              </div>

              <div style={{ marginBottom: 24, textAlign: 'center' }}>
                <a href="/api/auth/sso/oidc/start" className="ghost-button" style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, padding: '12px 16px', background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.85)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, textDecoration: 'none', fontWeight: 600, transition: 'background 0.15s ease, border-color 0.15s ease' }}>
                  <svg width="20" height="20" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
                    <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                    <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                    <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                    <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
                  </svg>
                  Sign in with Microsoft
                </a>
              </div>
              </>
              )}

              <p className="mm-login-request-row">
                Don&apos;t have an account?{' '}
                <button type="button" className="mm-login-request-link" onClick={openRequestAccess}>
                  Request access
                </button>
              </p>

              {itHelp}
            </div>
          </div>
        </div>
      </main>

      {requestOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="aae-auth-modal-overlay"
              role="presentation"
              onClick={e => {
                if (e.target === e.currentTarget) setRequestOpen(false)
              }}
            >
              <div
                ref={requestPanelRef}
                className="aae-auth-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="aae-request-access-title"
                onClick={e => e.stopPropagation()}
              >
                <button
                  ref={closeBtnRef}
                  type="button"
                  className="aae-auth-modal-close"
                  aria-label="Close"
                  onClick={() => setRequestOpen(false)}
                >
                  <X size={20} strokeWidth={2} aria-hidden />
                </button>
                <div className="aae-auth-modal-scroll">
                  <RequestAccessFlow
                    key={requestKey}
                    layout="modal"
                    onClose={() => setRequestOpen(false)}
                    onVerified={() => {
                      setBanner('Your access request was confirmed. When IT creates your sign-in, use it here.')
                    }}
                  />
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
