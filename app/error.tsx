'use client'

import { useEffect } from 'react'

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="aae-auth-page">
      <div className="aae-auth-card">
        <div className="slack-card mm-auth-form" style={{ padding: '28px 28px' }}>
          <h1 className="aae-auth-title">Something went wrong</h1>
          <p className="aae-auth-lead" style={{ marginBottom: 16 }}>
            The page hit an unexpected error. Try again or return to the sign-in screen. If it keeps happening, contact IT and share the message below when safe to do so.
          </p>
          {error.message ? (
            <pre
              style={{
                margin: '0 0 18px',
                padding: 12,
                background: '#fafafa',
                borderRadius: 'var(--mm-radius-ui)',
                fontSize: 12,
                overflow: 'auto',
                maxHeight: 120,
                border: '1px solid rgba(61, 60, 64, 0.14)'
              }}
            >
              {error.message}
            </pre>
          ) : null}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <button type="button" className="slack-button" onClick={() => reset()}>
              Try again
            </button>
            <a href="/login" className="ghost-button" style={{ display: 'inline-flex', alignItems: 'center' }}>
              Sign in
            </a>
          </div>
        </div>
      </div>
    </main>
  )
}
