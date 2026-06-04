'use client'

import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react'

/**
 * MFA step-up control rendered on /login?mfa=stepup.
 *
 * An SSO login from a provider with enforce_mfa=true sets the session cookie but
 * leaves it mfa_pending (readSessionUserId treats it as unauthenticated). The
 * user lands here with the cookie already set and must complete a second factor
 * to make the session usable. This component hosts that control instead of the
 * old informational-only banner, which stranded the user (re-submitting the
 * password form started an unrelated local-credential login).
 *
 * Two paths, both against handshake endpoints that need no CSRF (the session is
 * not yet usable):
 *   - TOTP   → POST /api/auth/mfa/stepup        ({ action:'begin' | 'verify' })
 *   - Passkey→ POST /api/auth/webauthn/authenticate ({ action:'begin'|'finish' })
 *
 * On success we hard-navigate to /home so the now-cleared cookie is reapplied.
 */

// ── WebAuthn base64url helpers (avoids a new @simplewebauthn/browser dep) ──────
// Returns a plain ArrayBuffer (not a Uint8Array view) so it satisfies the DOM
// `BufferSource` type the WebAuthn API expects for challenge / credential id.
function b64urlToArrayBuffer(value: string): ArrayBuffer {
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4))
  const b64 = (value + pad).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const buf = new ArrayBuffer(bin.length)
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return buf
}

function bytesToB64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

interface RequestOptionsJSON {
  challenge: string
  timeout?: number
  rpId?: string
  userVerification?: UserVerificationRequirement
  allowCredentials?: Array<{ id: string; type: 'public-key'; transports?: AuthenticatorTransport[] }>
}

function toPublicKeyRequest(options: RequestOptionsJSON): PublicKeyCredentialRequestOptions {
  return {
    challenge: b64urlToArrayBuffer(options.challenge),
    timeout: options.timeout,
    rpId: options.rpId,
    userVerification: options.userVerification,
    allowCredentials: (options.allowCredentials || []).map(c => ({
      id: b64urlToArrayBuffer(c.id),
      type: c.type,
      transports: c.transports,
    })),
  }
}

function serializeAssertion(cred: PublicKeyCredential) {
  const resp = cred.response as AuthenticatorAssertionResponse
  return {
    id: cred.id,
    rawId: bytesToB64url(cred.rawId),
    type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults(),
    response: {
      clientDataJSON: bytesToB64url(resp.clientDataJSON),
      authenticatorData: bytesToB64url(resp.authenticatorData),
      signature: bytesToB64url(resp.signature),
      userHandle: resp.userHandle ? bytesToB64url(resp.userHandle) : undefined,
    },
  }
}

export function MfaStepUp({ onComplete }: { onComplete: () => void }) {
  const [mode, setMode] = useState<'unknown' | 'totp' | 'enroll'>('unknown')
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [passkeySupported, setPasskeySupported] = useState(false)

  useEffect(() => {
    setPasskeySupported(typeof window !== 'undefined' && !!window.PublicKeyCredential)
  }, [])

  // Probe TOTP enrollment state up-front so the right control renders.
  const begin = useCallback(async () => {
    setError('')
    try {
      const res = await fetch('/api/auth/mfa/stepup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'begin' }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        enrolled?: boolean
        setup?: { secret: string; otpauth_uri: string }
        error?: string
      }
      if (res.status === 401) {
        setError('Your step-up session expired. Please sign in again.')
        return
      }
      if (!res.ok) {
        setError('Could not start multi-factor verification. Please try again.')
        return
      }
      if (data.enrolled) {
        setMode('totp')
      } else if (data.setup) {
        setSetup(data.setup)
        setMode('enroll')
      }
    } catch {
      setError('Could not start multi-factor verification. Please try again.')
    }
  }, [])

  useEffect(() => {
    void begin()
  }, [begin])

  const verifyTotp = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setBusy(true)
      setError('')
      try {
        const res = await fetch('/api/auth/mfa/stepup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ action: 'verify', code: code.trim() }),
        })
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
        if (res.ok && data.ok) {
          onComplete()
          return
        }
        if (data.error === 'invalid_code' || data.error === 'code_required') {
          setError('That code was not correct. Try again.')
        } else if (res.status === 401) {
          setError('Your step-up session expired. Please sign in again.')
        } else {
          setError('Verification failed. Please try again.')
        }
      } catch {
        setError('Verification failed. Please try again.')
      } finally {
        setBusy(false)
      }
    },
    [code, onComplete]
  )

  const verifyPasskey = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const beginRes = await fetch('/api/auth/webauthn/authenticate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'begin' }),
      })
      const beginData = (await beginRes.json().catch(() => ({}))) as {
        options?: RequestOptionsJSON
        error?: string
      }
      if (!beginRes.ok || !beginData.options) {
        setError(
          beginData.error === 'no_passkey_enrolled'
            ? 'No passkey is registered for this account. Use your authenticator code instead.'
            : 'Could not start passkey verification.'
        )
        return
      }

      const credential = (await navigator.credentials.get({
        publicKey: toPublicKeyRequest(beginData.options),
      })) as PublicKeyCredential | null
      if (!credential) {
        setError('Passkey verification was cancelled.')
        return
      }

      const finishRes = await fetch('/api/auth/webauthn/authenticate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'finish', response: serializeAssertion(credential) }),
      })
      const finishData = (await finishRes.json().catch(() => ({}))) as { ok?: boolean }
      if (finishRes.ok && finishData.ok) {
        onComplete()
        return
      }
      setError('Passkey verification failed. Please try again.')
    } catch {
      setError('Passkey verification failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }, [onComplete])

  return (
    <div className="mm-login-form" role="group" aria-label="Multi-factor authentication">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <ShieldCheck size={18} strokeWidth={2} aria-hidden />
        <strong>Complete multi-factor authentication</strong>
      </div>
      <p className="mm-login-subtitle" style={{ marginTop: 0 }}>
        You signed in successfully. Enter a verification code from your authenticator app to continue.
      </p>

      {mode === 'enroll' && setup ? (
        <div className="mm-login-server-info" aria-label="Authenticator setup">
          <p style={{ margin: 0, fontSize: 13 }}>
            No authenticator is set up yet. Add this account to your authenticator app, then enter the
            6-digit code it shows.
          </p>
          <code style={{ display: 'block', marginTop: 8, wordBreak: 'break-all', fontSize: 12 }}>
            {setup.secret}
          </code>
        </div>
      ) : null}

      <form className="mm-login-form" onSubmit={verifyTotp}>
        <label className="mm-login-label" htmlFor="aae-mfa-code">
          Authenticator code
        </label>
        <input
          id="aae-mfa-code"
          className="mm-login-input"
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          placeholder="123456"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'aae-mfa-error' : undefined}
        />

        {error ? (
          <div id="aae-mfa-error" className="mm-login-error" role="alert">
            <span>{error}</span>
          </div>
        ) : null}

        <button className="mm-login-submit" type="submit" disabled={busy || code.length !== 6}>
          {busy ? (
            <>
              <Loader2 size={18} className="spin" aria-hidden />
              Verifying…
            </>
          ) : (
            'Verify and continue'
          )}
        </button>
      </form>

      {passkeySupported ? (
        <>
          <div className="mm-login-divider">
            <span>or</span>
          </div>
          <button
            type="button"
            className="ghost-button"
            onClick={verifyPasskey}
            disabled={busy}
            style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 8,
              padding: '12px 16px',
              borderRadius: 8,
              fontWeight: 600,
            }}
          >
            <KeyRound size={18} strokeWidth={2} aria-hidden />
            Use a passkey
          </button>
        </>
      ) : null}
    </div>
  )
}
