'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ModuleChrome } from '@/app/components/ModuleChrome'

interface DocRow {
  id: string
  filename: string
  contentType: string
  size: number
  createdAt: number
}

export default function DocumentsPage() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('Upload a PDF to begin.')
  const [docs, setDocs] = useState<DocRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [configError, setConfigError] = useState('')

  const loadDocs = useCallback(async () => {
    const res = await fetch('/api/documents')
    if (res.status === 401) {
      window.location.href = '/login'
      return
    }
    if (res.status === 503) {
      setConfigError('Storage or database is not configured. Set DATABASE_URL and S3_* variables.')
      setDocs([])
      return
    }
    if (!res.ok) return
    const data = await res.json()
    setDocs(data.documents ?? [])
    setConfigError('')
  }, [])

  useEffect(() => {
    void loadDocs()
  }, [loadDocs])

  async function persistUpload(next: File | null) {
    if (!next) return
    setBusy(true)
    setMessage('Uploading...')
    const data = new FormData()
    data.set('file', next)
    const res = await fetch('/api/documents', { method: 'POST', body: data })
    setBusy(false)
    if (res.status === 503) {
      setConfigError('Storage or database is not configured.')
      return
    }
    if (!res.ok) {
      setMessage('Upload failed.')
      return
    }
    const body = await res.json()
    const id = body?.document?.id as string | undefined
    setFile(null)
    setMessage(id ? 'File saved.' : 'Upload complete.')
    if (id) setSelectedId(id)
    await loadDocs()
  }

  async function runOcr(saveMode: 'new' | 'current') {
    const docId = selectedId
    const useFile = file
    if (!docId && !useFile) {
      setMessage('Select a stored document or choose a PDF file.')
      return
    }
    setBusy(true)
    setMessage('Processing with Stirling-PDF...')
    const data = new FormData()
    if (docId) data.set('document_id', docId)
    if (useFile) data.set('file', useFile)
    data.set('languages', 'eng')
    const res = await fetch('/api/documents/ocr', { method: 'POST', body: data })
    setBusy(false)
    if (!res.ok) {
      setMessage('Processing failed. Check that Stirling-PDF is running.')
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const base = (useFile?.name || docs.find(d => d.id === docId)?.filename || 'document').replace(/\.pdf$/i, '')
    const suffix = saveMode === 'new' ? '-edited' : ''
    a.download = `${base}${suffix}-ocr.pdf`
    a.click()
    URL.revokeObjectURL(url)
    setMessage(saveMode === 'new' ? 'Exported as a new file.' : 'Downloaded OCR result.')
  }

  function pickFile() {
    inputRef.current?.click()
  }

  function downloadStored(id: string) {
    window.open(`/api/documents/${encodeURIComponent(id)}/download`, '_blank', 'noopener,noreferrer')
  }

  function downloadOriginalLocal() {
    if (!file) return
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="module-page">
      <ModuleChrome
        title="Documents"
        subtitle="Files are stored in S3-compatible object storage with metadata in PostgreSQL."
        actions={
          <div className="doc-actions">
            <button type="button" className="ghost-button light" onClick={pickFile}>
              Upload document
            </button>
            <button type="button" className="ghost-button light" onClick={downloadOriginalLocal} disabled={!file}>
              Download original (local)
            </button>
          </div>
        }
      />

      {configError ? <p className="form-error">{configError}</p> : null}

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="visually-hidden"
        onChange={e => {
          const next = e.target.files?.[0] ?? null
          setFile(next)
          setMessage(next ? `Selected: ${next.name}` : 'Upload a PDF to begin.')
          if (next) void persistUpload(next)
        }}
      />

      <section className="doc-layout">
        <div
          className="drop-zone"
          role="button"
          tabIndex={0}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault()
            const next = e.dataTransfer.files?.[0] ?? null
            if (next && next.type === 'application/pdf') {
              setFile(next)
              setMessage(`Selected: ${next.name}`)
              void persistUpload(next)
            }
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              pickFile()
            }
          }}
          onClick={pickFile}
        >
          <strong>{message}</strong>
          <span>Drag and drop a PDF here, or click to choose a file. Uploads persist automatically.</span>
        </div>

        <div className="doc-save-row">
          <button type="button" className="slack-button" disabled={busy || (!selectedId && !file)} onClick={() => void runOcr('current')}>
            {busy ? 'Processing' : 'Save to current (OCR)'}
          </button>
          <button
            type="button"
            className="slack-button secondary"
            disabled={busy || (!selectedId && !file)}
            onClick={() => void runOcr('new')}
          >
            Save as new (OCR)
          </button>
        </div>
      </section>

      <section style={{ marginTop: 28 }}>
        <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>Stored files</h2>
        {docs.length === 0 ? (
          <p className="doc-muted">No uploads yet.</p>
        ) : (
          <table className="doc-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Size</th>
                <th>Uploaded</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {docs.map(d => (
                <tr key={d.id}>
                  <td>
                    <button type="button" className="link-button" onClick={() => setSelectedId(d.id)}>
                      {d.filename}
                    </button>
                    {selectedId === d.id ? <span className="doc-muted"> selected</span> : null}
                  </td>
                  <td>{(d.size / 1024).toFixed(1)} KB</td>
                  <td>{new Date(d.createdAt).toLocaleString()}</td>
                  <td>
                    <button type="button" className="ghost-button light" onClick={() => downloadStored(d.id)}>
                      Download
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}
