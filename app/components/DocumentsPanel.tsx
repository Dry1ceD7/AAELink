'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/apiClient'

interface DocRow {
  id: string
  filename: string
  contentType: string
  size: number
  createdAt: number
}

export function DocumentsPanel({ workspaceId }: { workspaceId: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('Upload a document to begin.')
  const [docs, setDocs] = useState<DocRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [configError, setConfigError] = useState('')
  const [pendingDeleteDoc, setPendingDeleteDoc] = useState<{ id: string; filename: string } | null>(null)

  const loadDocs = useCallback(async () => {
    if (!workspaceId) return
    const res = await apiFetch(`/api/documents?workspace_id=${encodeURIComponent(workspaceId)}`)
    if (res.status === 401) {
      window.location.href = '/login'
      return
    }
    if (res.status === 503) {
      setConfigError('Documents are not available on this server. Contact your IT administrator.')
      setDocs([])
      return
    }
    if (res.status === 403) {
      setConfigError('You are not a member of this workspace.')
      setDocs([])
      return
    }
    if (!res.ok) return
    const data = await res.json()
    setDocs(data.documents ?? [])
    setConfigError('')
  }, [workspaceId])

  useEffect(() => {
    void loadDocs()
  }, [loadDocs])

  async function persistUpload(next: File | null) {
    if (!next || !workspaceId) return
    setBusy(true)
    setMessage('Uploading...')
    const data = new FormData()
    data.set('workspace_id', workspaceId)
    data.set('file', next)
    const res = await apiFetch('/api/documents', { method: 'POST', body: data })
    setBusy(false)
    if (res.status === 503) {
      setConfigError('Upload is not available on this server. Contact your IT administrator.')
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
    const res = await apiFetch('/api/documents/ocr', { method: 'POST', body: data })
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

  async function downloadStored(id: string) {
    const res = await apiFetch(`/api/documents/${encodeURIComponent(id)}/download`)
    if (!res.ok) {
      setMessage('Download failed.')
      return
    }
    const blob = await res.blob()
    const row = docs.find(d => d.id === id)
    const name = row?.filename || 'download'
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
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

  async function confirmDeleteDoc() {
    const doc = pendingDeleteDoc
    if (!doc) return
    setPendingDeleteDoc(null)
    setBusy(true)
    setMessage('Deleting...')
    const res = await apiFetch(`/api/documents/${encodeURIComponent(doc.id)}`, { method: 'DELETE' })
    setBusy(false)
    if (!res.ok) {
      setMessage('Delete failed.')
      return
    }
    if (selectedId === doc.id) setSelectedId(null)
    setMessage('File deleted.')
    await loadDocs()
  }

  if (!workspaceId) {
    return <p className="doc-muted">Choose a workspace to use documents.</p>
  }

  return (
    <div className="mm-module-inner">
      <p className="mm-module-lead">
        Files are stored in S3-compatible object storage with metadata in PostgreSQL for this workspace.
      </p>

      <div className="doc-actions mm-module-doc-actions">
        <button type="button" className="ghost-button" onClick={pickFile}>
          Upload document
        </button>
        <button type="button" className="ghost-button" onClick={() => void downloadOriginalLocal()} disabled={!file}>
          Download original (local)
        </button>
      </div>

      {configError ? <p className="form-error">{configError}</p> : null}

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv,image/png,image/jpeg,image/webp,image/gif"
        className="visually-hidden"
        onChange={e => {
          const next = e.target.files?.[0] ?? null
          setFile(next)
          setMessage(next ? `Selected: ${next.name}` : 'Upload a document to begin.')
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
            if (next) {
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
          <span>Drag and drop a file here, or click to choose. Uploads persist automatically.</span>
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
                <th>Type</th>
                <th>Size</th>
                <th>Uploaded</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {docs.map(d => {
                const ext = d.filename.split('.').pop()?.toLowerCase() || ''
                const typeLabel = d.contentType.startsWith('image/') ? '🖼️ Image'
                  : ext === 'pdf' ? '📄 PDF'
                  : ext === 'csv' ? '📊 CSV'
                  : ext === 'md' ? '📝 Markdown'
                  : ext === 'txt' ? '📃 Text'
                  : ext === 'doc' || ext === 'docx' ? '📋 Word'
                  : '📎 File'
                return (
                  <tr key={d.id}>
                    <td>
                      <button type="button" className="link-button" onClick={() => setSelectedId(d.id)}>
                        {d.filename}
                      </button>
                      {selectedId === d.id ? <span className="doc-muted"> selected</span> : null}
                    </td>
                    <td><span className="doc-type-badge">{typeLabel}</span></td>
                    <td>{(d.size / 1024).toFixed(1)} KB</td>
                    <td>{new Date(d.createdAt).toLocaleString()}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" className="ghost-button" onClick={() => void downloadStored(d.id)}>
                          Download
                        </button>
                        <button type="button" className="ghost-button ghost-button--danger"
                          disabled={busy}
                          onClick={() => setPendingDeleteDoc({ id: d.id, filename: d.filename })}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Delete confirmation modal ─────────────────────────── */}
      {pendingDeleteDoc && (
        <div className="mm-modal-overlay" role="presentation" onClick={() => setPendingDeleteDoc(null)}>
          <div className="mm-modal" role="alertdialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            <h2>Delete file?</h2>
            <p className="mm-editor-hint" style={{ marginTop: 8 }}>
              Are you sure you want to delete &quot;{pendingDeleteDoc.filename}&quot;? This action cannot be undone.
            </p>
            <div className="mm-modal-actions">
              <button type="button" className="ghost-button" onClick={() => setPendingDeleteDoc(null)}>Cancel</button>
              <button type="button" className="slack-button" style={{ background: '#D24B4E' }}
                onClick={() => void confirmDeleteDoc()}>Delete file</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
