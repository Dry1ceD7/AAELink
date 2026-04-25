'use client'

import { useEffect, useState } from 'react'
import { FileText, RefreshCw } from 'lucide-react'
import { documentsApi } from '@/lib/api'
import type { DocumentRecord } from '@/lib/types'
import { Button } from '@/components/ui/button'

export default function DocumentsPage() {
  const [rows, setRows] = useState<DocumentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await documentsApi.list()
      setRows(res.documents)
    } catch {
      setError('Document module is unavailable. Other AAELink modules remain online.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[color:var(--fg)]">
            Documents
          </h1>
          <p className="mt-1 text-sm text-[color:var(--muted)]">
            Secure PDF processing foundation for preview, OCR, redaction,
            annotations, forms, signing, and export operations.
          </p>
        </div>
        <Button variant="outline" onClick={load} loading={loading}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)]">
        {rows.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
            <FileText className="h-10 w-10 text-[color:var(--muted)]" />
            <h2 className="mt-3 text-base font-semibold text-[color:var(--fg)]">
              No documents yet
            </h2>
            <p className="mt-1 max-w-md text-sm text-[color:var(--muted)]">
              The backend module is isolated and ready for PDF operation queues.
              Upload and editing surfaces will attach here without affecting
              tickets, auth, or notifications.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[color:var(--border)]">
            {rows.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between gap-4 p-4">
                <div>
                  <p className="font-medium text-[color:var(--fg)]">{doc.filename}</p>
                  <p className="text-xs text-[color:var(--muted)]">
                    v{doc.version} / {doc.status} / {doc.mime_type}
                  </p>
                </div>
                <span className="text-xs text-[color:var(--muted)]">
                  {new Date(doc.created_at).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
