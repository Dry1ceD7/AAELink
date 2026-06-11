'use client'

/**
 * Documents module shell.
 *
 * Four tabs after the v0.0.20-alpha cleanup:
 *
 *   • Files     — uploaded binaries (PDF, DOCX, images), OCR via Stirling-PDF
 *   • Templates — Puzzle Box block-tree templates (drag, swap, reorder)
 *   • Clients   — workspace customers (logo, branding, address, tax id)
 *   • Pipeline  — assemblies in flight: ingest → extract → … → deliver
 *
 * The legacy "Quick assembly" wizard and the older docx-with-placeholders
 * "Templates" tab were retired — both are subsumed by the block-tree editor.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api/apiClient'
import { toast } from '@/lib/ui/toast'
import { DocumentViewer } from './DocumentViewer'
import { HtmlTemplatesPanel } from '@/components/workspace/HtmlTemplatesPanel'
import { ClientsPanel } from '@/components/user/ClientsPanel'
import { AssemblyPipelinePanel } from './AssemblyPipelinePanel'
import {
  FileText, Building2, Upload, Download, Trash2, Eye,
  Search, ScanText, X, Code, Workflow,
} from 'lucide-react'

interface DocRow {
  id: string; filename: string; contentType: string; size: number; createdAt: number
}

type DocTab = 'files' | 'templates' | 'clients' | 'pipeline'

export function DocumentsPanel({ workspaceId }: { workspaceId: string }) {
  const [tab, setTab] = useState<DocTab>('files')
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [docs, setDocs] = useState<DocRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [configError, setConfigError] = useState('')
  const [pendingDeleteDoc, setPendingDeleteDoc] = useState<{ id: string; filename: string } | null>(null)
  const [previewDoc, setPreviewDoc] = useState<DocRow | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const loadDocs = useCallback(async () => {
    if (!workspaceId) return
    const res = await apiFetch(`/api/documents?workspace_id=${encodeURIComponent(workspaceId)}`)
    if (res.status === 401) { window.location.href = '/login'; return }
    if (res.status === 503) { setConfigError('Documents are not available. Contact IT.'); setDocs([]); return }
    if (res.status === 403) { setConfigError('You are not a member of this workspace.'); setDocs([]); return }
    if (!res.ok) { toast.error('Failed to load documents.'); return }
    const data = await res.json()
    setDocs(data.documents ?? [])
    setConfigError('')
  }, [workspaceId])

  useEffect(() => { void loadDocs() }, [loadDocs])

  async function persistUpload(next: File | null) {
    if (!next || !workspaceId) return
    setBusy(true); setMessage('Uploading...')
    const data = new FormData()
    data.set('workspace_id', workspaceId)
    data.set('file', next)
    const res = await apiFetch('/api/documents', { method: 'POST', body: data })
    setBusy(false)
    if (res.status === 503) { setConfigError('Upload not available.'); toast.error('Upload not available.'); return }
    if (!res.ok) { setMessage('Upload failed.'); toast.error('Upload failed.'); return }
    const body = await res.json()
    const id = body?.document?.id as string | undefined
    setFile(null); setMessage(id ? 'File saved.' : 'Upload complete.')
    toast.success(id ? 'File saved.' : 'Upload complete.')
    if (id) setSelectedId(id)
    await loadDocs()
  }

  async function runOcr(saveMode: 'new' | 'current') {
    const docId = selectedId; const useFile = file
    if (!docId && !useFile) { setMessage('Select a stored document or choose a PDF file.'); return }
    setBusy(true); setMessage('Processing with Stirling-PDF...')
    const data = new FormData()
    if (docId) data.set('document_id', docId)
    if (useFile) data.set('file', useFile)
    data.set('languages', 'eng')
    const res = await apiFetch('/api/documents/ocr', { method: 'POST', body: data })
    setBusy(false)
    if (!res.ok) { setMessage('Processing failed. Check that Stirling-PDF is running.'); toast.error('OCR processing failed. Check that Stirling-PDF is running.'); return }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const base = (useFile?.name || docs.find(d => d.id === docId)?.filename || 'document').replace(/\.pdf$/i, '')
    const suffix = saveMode === 'new' ? '-edited' : ''
    a.download = `${base}${suffix}-ocr.pdf`
    a.click(); URL.revokeObjectURL(url)
    setMessage(saveMode === 'new' ? 'Exported as a new file.' : 'Downloaded OCR result.')
  }

  function pickFile() { inputRef.current?.click() }

  async function downloadStored(id: string) {
    try {
      const res = await apiFetch(`/api/documents/${encodeURIComponent(id)}/download`)
      if (res.status === 401) { window.location.href = '/login'; return }
      if (!res.ok) { setMessage('Download failed.'); toast.error('Download failed.'); return }
      const blob = await res.blob()
      const row = docs.find(d => d.id === id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = row?.filename || 'download'
      a.click(); URL.revokeObjectURL(url)
    } catch {
      setMessage('Download failed.'); toast.error('Download failed.')
    }
  }

  async function confirmDeleteDoc() {
    const doc = pendingDeleteDoc; if (!doc) return
    setPendingDeleteDoc(null); setBusy(true); setMessage('Deleting...')
    try {
      const res = await apiFetch(`/api/documents/${encodeURIComponent(doc.id)}`, { method: 'DELETE' })
      setBusy(false)
      if (!res.ok) { setMessage('Delete failed.'); toast.error('Delete failed.'); return }
      if (selectedId === doc.id) setSelectedId(null)
      setMessage('File deleted.'); toast.success('File deleted.'); await loadDocs()
    } catch {
      setBusy(false); setMessage('Delete failed.'); toast.error('Delete failed.')
    }
  }

  if (!workspaceId) return <p className="doc-muted">Choose a workspace to use documents.</p>

  const filteredDocs = searchQuery
    ? docs.filter(d => d.filename.toLowerCase().includes(searchQuery.toLowerCase()))
    : docs

  const tabs: { key: DocTab; label: string; icon: React.ReactNode }[] = [
    { key: 'files',     label: 'Files',     icon: <FileText size={15} /> },
    { key: 'templates', label: 'Templates', icon: <Code size={15} /> },
    { key: 'clients',   label: 'Clients',   icon: <Building2 size={15} /> },
    { key: 'pipeline',  label: 'Pipeline',  icon: <Workflow size={15} /> },
  ]

  function getTypeLabel(d: DocRow) {
    const ext = d.filename.split('.').pop()?.toLowerCase() || ''
    if (d.contentType.startsWith('image/')) return 'Image'
    if (ext === 'pdf') return 'PDF'
    if (ext === 'csv') return 'CSV'
    if (ext === 'md') return 'Markdown'
    if (ext === 'txt') return 'Text'
    if (ext === 'doc' || ext === 'docx') return 'Word'
    return 'File'
  }

  return (
    <div className="docs-tabbed-panel">
      {/* Tab bar */}
      <div className="docs-tab-bar">
        {tabs.map(t => (
          <button
            key={t.key}
            className={`docs-tab-btn${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.icon}
            <span>{t.label}</span>
            {t.key === 'files' && docs.length > 0 && (
              <span className="docs-tab-badge">{docs.length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="docs-tab-content">
        {/* ── FILES TAB ── */}
        {tab === 'files' && (
          <div className="docs-files-tab">
            {configError && <p className="form-error">{configError}</p>}

            <div className="docs-toolbar">
              <div className="docs-search-box">
                <Search size={14} />
                <input
                  type="text"
                  placeholder="Search files..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button className="docs-search-clear" onClick={() => setSearchQuery('')}>
                    <X size={12} />
                  </button>
                )}
              </div>
              <div className="docs-toolbar-actions">
                <button type="button" className="docs-action-btn docs-action-btn--primary" onClick={pickFile}>
                  <Upload size={14} /> Upload
                </button>
                <button
                  type="button" className="docs-action-btn"
                  disabled={busy || (!selectedId && !file)}
                  onClick={() => void runOcr('current')}
                >
                  <ScanText size={14} /> {busy ? 'Processing...' : 'OCR'}
                </button>
              </div>
            </div>

            <input
              ref={inputRef} type="file"
              accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv,image/png,image/jpeg,image/webp,image/gif"
              className="visually-hidden"
              onChange={e => {
                const next = e.target.files?.[0] ?? null
                setFile(next)
                setMessage(next ? `Selected: ${next.name}` : '')
                if (next) void persistUpload(next)
              }}
            />

            <div
              className="docs-drop-zone"
              role="button" tabIndex={0}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault()
                const next = e.dataTransfer.files?.[0] ?? null
                if (next) { setFile(next); setMessage(`Selected: ${next.name}`); void persistUpload(next) }
              }}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFile() } }}
              onClick={pickFile}
            >
              <Upload size={24} className="docs-drop-icon" />
              <strong>{message || 'Drag and drop files here, or click to browse'}</strong>
              <span className="docs-drop-hint">
                Supports PDF, Word, Text, CSV, Markdown, and images. For structured documents (invoice, quote, …) use the <strong>Templates</strong> tab.
              </span>
            </div>

            <div className="docs-file-list">
              <div className="docs-file-list-header">
                <h3>Stored Files {filteredDocs.length > 0 && <span className="docs-count">({filteredDocs.length})</span>}</h3>
              </div>
              {filteredDocs.length === 0 ? (
                <div className="docs-empty-state">
                  <FileText size={32} />
                  <p>{searchQuery ? 'No files match your search.' : 'No uploads yet. Upload a document to get started.'}</p>
                </div>
              ) : (
                <div className="docs-file-cards">
                  {filteredDocs.map(d => (
                    <div key={d.id} className={`docs-file-card${selectedId === d.id ? ' selected' : ''}`}>
                      <div className="docs-file-card-main" onClick={() => setSelectedId(d.id)}>
                        <span className="docs-file-type">{getTypeLabel(d)}</span>
                        <div className="docs-file-info">
                          <span className="docs-file-name">{d.filename}</span>
                          <span className="docs-file-meta">
                            {(d.size / 1024).toFixed(1)} KB · {new Date(d.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <div className="docs-file-actions">
                        <button title="Preview" onClick={() => setPreviewDoc(d)}><Eye size={14} /></button>
                        <button title="Download" onClick={() => void downloadStored(d.id)}><Download size={14} /></button>
                        <button title="Delete" className="docs-btn-danger" disabled={busy}
                          onClick={() => setPendingDeleteDoc({ id: d.id, filename: d.filename })}><Trash2 size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── TEMPLATES TAB (block-tree) ── */}
        {tab === 'templates' && <HtmlTemplatesPanel workspaceId={workspaceId} />}

        {/* ── CLIENTS TAB ── */}
        {tab === 'clients' && <ClientsPanel workspaceId={workspaceId} />}

        {/* ── PIPELINE TAB (Puzzle Box runs) ── */}
        {tab === 'pipeline' && <AssemblyPipelinePanel workspaceId={workspaceId} />}
      </div>

      {pendingDeleteDoc && (
        <div className="mm-modal-overlay" role="presentation" onClick={() => setPendingDeleteDoc(null)}>
          <div className="mm-modal" role="alertdialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            <h2>Delete file?</h2>
            <p className="mm-editor-hint" style={{ marginTop: 8 }}>
              Are you sure you want to delete &quot;{pendingDeleteDoc.filename}&quot;? This cannot be undone.
            </p>
            <div className="mm-modal-actions">
              <button type="button" className="ghost-button" onClick={() => setPendingDeleteDoc(null)}>Cancel</button>
              <button type="button" className="slack-button" style={{ background: '#D24B4E' }}
                onClick={() => void confirmDeleteDoc()}>Delete file</button>
            </div>
          </div>
        </div>
      )}

      {previewDoc && (
        <DocumentViewer
          url={`/api/documents/${encodeURIComponent(previewDoc.id)}/download`}
          filename={previewDoc.filename}
          mimeType={previewDoc.contentType}
          documentId={previewDoc.id}
          workspaceId={workspaceId}
          fileSize={previewDoc.size}
          onClose={() => setPreviewDoc(null)}
          onDocumentCreated={() => { void loadDocs() }}
        />
      )}
    </div>
  )
}
