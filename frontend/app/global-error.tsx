'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('global error:', error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          background: '#0b0b0c',
          color: '#f3f3f5',
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
        }}
      >
        <div
          style={{
            maxWidth: 480,
            width: '100%',
            background: '#141416',
            border: '1px solid #2a2a2e',
            borderRadius: 12,
            padding: 24,
            textAlign: 'center',
          }}
        >
          <h1 style={{ fontSize: 18, margin: '0 0 8px', fontWeight: 600 }}>
            AAELink encountered a critical error
          </h1>
          <p style={{ margin: '0 0 16px', color: '#9aa0a6', fontSize: 14 }}>
            The application caught the failure and stayed up. Reload to recover.
          </p>
          {error?.digest ? (
            <p
              style={{
                margin: '0 0 16px',
                color: '#9aa0a6',
                fontSize: 12,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              }}
            >
              {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '10px 16px',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  )
}
