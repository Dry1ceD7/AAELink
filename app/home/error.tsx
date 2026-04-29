'use client'

import { useEffect } from 'react'
import Link from 'next/link'

export default function HomeError({
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
    <main className="mm-app mm-workspaces-gate mm-workspaces-gate--error" style={{ minHeight: '100dvh' }}>
      <div style={{ maxWidth: 440, textAlign: 'center', padding: 24 }}>
        <h1 style={{ margin: '0 0 10px', fontSize: 20, fontWeight: 700 }}>This workspace view failed to load</h1>
        <p style={{ margin: '0 0 16px', color: 'var(--mm-muted)', fontSize: 14, lineHeight: 1.5 }}>
          Channels and the rest of the app are unchanged. You can retry this screen or open another area.
        </p>
        {error.message ? (
          <pre
            style={{
              margin: '0 0 18px',
              padding: 12,
              textAlign: 'left',
              background: 'var(--mm-input-bg, #fafafa)',
              borderRadius: 8,
              fontSize: 12,
              overflow: 'auto',
              maxHeight: 100,
              border: '1px solid rgba(0,0,0,0.08)'
            }}
          >
            {error.message}
          </pre>
        ) : null}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
          <button type="button" className="slack-button" onClick={() => reset()}>
            Try again
          </button>
          <Link href="/workspaces" className="ghost-button" style={{ display: 'inline-flex', alignItems: 'center' }}>
            Workspaces
          </Link>
          <Link href="/settings" className="ghost-button" style={{ display: 'inline-flex', alignItems: 'center' }}>
            Settings
          </Link>
        </div>
      </div>
    </main>
  )
}
