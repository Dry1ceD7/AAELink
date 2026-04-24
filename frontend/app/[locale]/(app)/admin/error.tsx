'use client'

import { useEffect } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('admin-segment error:', error)
  }, [error])

  return (
    <div className="rounded-[--radius-card] border border-[color:var(--border)] bg-[color:var(--surface)] p-6 shadow-sm">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-[color:var(--fg)]">
            Admin section unavailable
          </h2>
          <p className="text-sm text-[color:var(--muted)]">
            The rest of the app keeps running. Retry to recover this panel.
          </p>
        </div>
      </div>
      {error?.digest ? (
        <p className="mb-3 font-mono text-xs text-[color:var(--muted)]">
          {error.digest}
        </p>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="inline-flex items-center gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-2 text-sm font-medium hover:bg-[color:var(--surface-3)] transition"
      >
        <RotateCw className="h-4 w-4" />
        Retry
      </button>
    </div>
  )
}
