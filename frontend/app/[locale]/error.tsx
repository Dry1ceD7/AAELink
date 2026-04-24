'use client'

import { useEffect } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'

export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('locale-segment error:', error)
  }, [error])

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md rounded-[--radius-card] border border-[color:var(--border)] bg-[color:var(--surface)] p-8 shadow-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-semibold text-[color:var(--fg)]">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-[color:var(--muted)]">
          The rest of the app is still running. You can retry this section.
        </p>
        {error?.digest ? (
          <p className="mt-2 font-mono text-xs text-[color:var(--muted)]">
            {error.digest}
          </p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex items-center gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] px-4 py-2 text-sm font-medium hover:bg-[color:var(--surface-3)] transition"
        >
          <RotateCw className="h-4 w-4" />
          Try again
        </button>
      </div>
    </main>
  )
}
