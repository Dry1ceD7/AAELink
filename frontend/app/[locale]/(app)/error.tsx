'use client'

import { useEffect } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('app-segment error:', error)
  }, [error])

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-12">
      <div className="w-full max-w-md rounded-[--radius-card] border border-[color:var(--border)] bg-[color:var(--surface)] p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[color:var(--fg)]">
              This module hit an error
            </h2>
            <p className="text-sm text-[color:var(--muted)]">
              Other parts of AAELink keep working. You can retry just this view.
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
          Reload module
        </button>
      </div>
    </div>
  )
}
