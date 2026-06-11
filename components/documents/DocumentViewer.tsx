'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Download, X, ZoomIn, ZoomOut, RotateCw, Scissors, Merge, FileText,
  ScanText, Stamp, ChevronLeft, ChevronRight, Maximize2, Minimize2,
  History, FileOutput, Eraser, Layers, PenTool, Highlighter,
  Shield, FileInput, Loader2
} from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import { AnnotationOverlay } from './AnnotationOverlay'
import { SignaturePanel } from './SignaturePanel'
import { PdfFormFieldsPanel } from './PdfFormFieldsPanel'
import { RedactionPanel } from './RedactionPanel'
import { AssemblyIngestModal } from './AssemblyIngestModal'

// ── Type helpers ────────────────────────────────────────────────────────────

function isImage(mime?: string, name?: string): boolean {
  if (mime?.startsWith('image/')) return true
  if (name) {
    const ext = name.split('.').pop()?.toLowerCase() || ''
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)
  }
  return false
}

function isPdf(mime?: string, name?: string): boolean {
  if (mime === 'application/pdf') return true
  if (name?.toLowerCase().endsWith('.pdf')) return true
  return false
}

function isCsv(mime?: string, name?: string): boolean {
  if (mime === 'text/csv') return true
  if (name?.toLowerCase().endsWith('.csv')) return true
  return false
}

function isOffice(mime?: string, name?: string): boolean {
  const officeMimes = [
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ]
  if (mime && officeMimes.includes(mime)) return true
  if (name) {
    const ext = name.split('.').pop()?.toLowerCase() || ''
    return ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)
  }
  return false
}

function isText(mime?: string, name?: string): boolean {
  if (mime?.startsWith('text/') && !isCsv(mime, name)) return true
  if (name) {
    const ext = name.split('.').pop()?.toLowerCase() || ''
    return ['txt', 'md', 'json', 'log', 'yaml', 'yml', 'xml', 'toml', 'ini', 'cfg'].includes(ext)
  }
  return false
}

function isVideo(mime?: string, name?: string): boolean {
  if (mime?.startsWith('video/')) return true
  if (name) {
    const ext = name.split('.').pop()?.toLowerCase() || ''
    return ['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)
  }
  return false
}

function isAudio(mime?: string, name?: string): boolean {
  if (mime?.startsWith('audio/')) return true
  if (name) {
    const ext = name.split('.').pop()?.toLowerCase() || ''
    return ['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a'].includes(ext)
  }
  return false
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── CSV Renderer ────────────────────────────────────────────────────────────

interface CsvData {
  headers: string[]
  rows: string[][]
}

function parseCsvText(text: string): CsvData {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length === 0) return { headers: [], rows: [] }

  const parseLine = (line: string): string[] => {
    const cells: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; continue }
        inQuotes = !inQuotes; continue
      }
      if (ch === ',' && !inQuotes) { cells.push(current.trim()); current = ''; continue }
      current += ch
    }
    cells.push(current.trim())
    return cells
  }

  const headers = parseLine(lines[0])
  const rows = lines.slice(1).map(parseLine)
  return { headers, rows }
}

const CsvViewer = memo(function CsvViewer({ text }: { text: string }) {
  const { headers, rows } = parseCsvText(text)
  const [sortCol, setSortCol] = useState(-1)
  const [sortAsc, setSortAsc] = useState(true)
  const [filterText, setFilterText] = useState('')

  const filtered = filterText
    ? rows.filter(r => r.some(c => c.toLowerCase().includes(filterText.toLowerCase())))
    : rows

  const sorted = sortCol >= 0
    ? [...filtered].sort((a, b) => {
        const av = a[sortCol] || ''
        const bv = b[sortCol] || ''
        const numA = Number(av), numB = Number(bv)
        if (!isNaN(numA) && !isNaN(numB)) return sortAsc ? numA - numB : numB - numA
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
      })
    : filtered

  return (
    <div className="docviewer-csv">
      <div className="docviewer-csv-toolbar">
        <input
          type="text"
          className="docviewer-csv-filter"
          placeholder="Filter rows…"
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
        />
        <span className="docviewer-csv-count">
          {sorted.length} / {rows.length} rows
        </span>
      </div>
      <div className="docviewer-csv-scroll">
        <table className="docviewer-csv-table">
          <thead>
            <tr>
              <th className="docviewer-csv-rownum">#</th>
              {headers.map((h, i) => (
                <th
                  key={i}
                  onClick={() => {
                    if (sortCol === i) setSortAsc(!sortAsc)
                    else { setSortCol(i); setSortAsc(true) }
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  {h}
                  {sortCol === i ? (sortAsc ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 500).map((row, ri) => (
              <tr key={ri}>
                <td className="docviewer-csv-rownum">{ri + 1}</td>
                {headers.map((_, ci) => (
                  <td key={ci}>{row[ci] || ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length > 500 && (
          <p className="docviewer-csv-limit">Showing first 500 of {sorted.length} rows.</p>
        )}
      </div>
    </div>
  )
})

// ── Version History Panel ───────────────────────────────────────────────────

interface DocVersion {
  id: string
  version_number: number
  filename: string
  size_bytes: number
  change_summary: string
  created_by: string
  created_at: number
  creator_username?: string
}

function VersionHistoryPanel({
  documentId,
  open,
  onClose,
  onSelectVersion
}: {
  documentId: string
  open: boolean
  onClose: () => void
  onSelectVersion: (version: DocVersion) => void
}) {
  const [versions, setVersions] = useState<DocVersion[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !documentId) return
    setLoading(true)
    void (async () => {
      const res = await apiFetch(`/api/documents/${encodeURIComponent(documentId)}/versions`)
      if (res.ok) {
        const data = await res.json() as { versions?: DocVersion[] }
        setVersions(data.versions ?? [])
      }
      setLoading(false)
    })()
  }, [open, documentId])

  if (!open) return null

  return (
    <div className="docviewer-versions-panel">
      <div className="docviewer-versions-header">
        <h3>Version History</h3>
        <button type="button" className="mm-icon-btn" onClick={onClose} title="Close">
          <X size={16} />
        </button>
      </div>
      <div className="docviewer-versions-list">
        {loading ? (
          <p className="docviewer-versions-empty">Loading…</p>
        ) : versions.length === 0 ? (
          <p className="docviewer-versions-empty">No version history.</p>
        ) : (
          versions.map(v => (
            <button
              key={v.id}
              type="button"
              className="docviewer-version-item"
              onClick={() => onSelectVersion(v)}
            >
              <div className="docviewer-version-num">v{v.version_number}</div>
              <div className="docviewer-version-meta">
                <span className="docviewer-version-name">{v.filename}</span>
                <span className="docviewer-version-info">
                  {formatBytes(v.size_bytes)} · {v.change_summary || 'No description'}
                </span>
                <span className="docviewer-version-date">
                  {v.creator_username ? `@${v.creator_username} · ` : ''}
                  {new Date(v.created_at).toLocaleString()}
                </span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

// ── PDF Operations Toolbar ──────────────────────────────────────────────────

type PdfOp = 'split' | 'rotate' | 'ocr' | 'redact' | 'watermark' | 'extract_pages' | 'convert_to_pdf'

function PdfOperationsToolbar({
  documentId,
  workspaceId,
  filename,
  canConvert,
  onOperationComplete
}: {
  documentId: string
  workspaceId: string
  filename: string
  canConvert: boolean
  onOperationComplete: (newDoc: { id: string; filename: string }) => void
}) {
  const [activeOp, setActiveOp] = useState<PdfOp | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function runOperation(op: PdfOp) {
    setBusy(true)
    setError('')

    const body: Record<string, unknown> = {
      operation: op,
      document_ids: [documentId],
      workspace_id: workspaceId,
    }

    switch (op) {
      case 'split':
      case 'extract_pages':
        if (!inputValue.trim()) { setError('Enter page ranges (e.g. 1-3,5)'); setBusy(false); return }
        body.pages = inputValue.trim()
        break
      case 'rotate':
        body.angle = Number(inputValue) || 90
        break
      case 'redact':
        if (!inputValue.trim()) { setError('Enter text to redact'); setBusy(false); return }
        body.search_text = inputValue.trim()
        break
      case 'watermark':
        if (!inputValue.trim()) { setError('Enter watermark text'); setBusy(false); return }
        body.watermark_text = inputValue.trim()
        break
    }

    try {
      const res = await apiFetch('/api/documents/operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data = await res.json() as { document?: { id: string; filename: string } }
        if (data.document) {
          onOperationComplete(data.document)
          setActiveOp(null)
          setInputValue('')
        }
      } else {
        const data = await res.json().catch(() => ({})) as { error?: string; detail?: string }
        setError(data.detail || data.error || 'Operation failed')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation failed')
    } finally {
      setBusy(false)
    }
  }

  const ops: { key: PdfOp; icon: React.ReactNode; label: string; needsInput?: string }[] = [
    { key: 'extract_pages', icon: <Scissors size={14} />, label: 'Extract Pages', needsInput: 'Pages (e.g. 1-3,5)' },
    { key: 'rotate', icon: <RotateCw size={14} />, label: 'Rotate', needsInput: 'Angle (90, 180, 270)' },
    { key: 'ocr', icon: <ScanText size={14} />, label: 'OCR' },
    { key: 'redact', icon: <Eraser size={14} />, label: 'Redact', needsInput: 'Text to redact' },
    { key: 'watermark', icon: <Stamp size={14} />, label: 'Watermark', needsInput: 'Watermark text' },
  ]
  if (canConvert) {
    ops.push({ key: 'convert_to_pdf', icon: <FileOutput size={14} />, label: 'Convert to PDF' })
  }

  return (
    <div className="docviewer-ops">
      <div className="docviewer-ops-buttons">
        {ops.map(op => (
          <button
            key={op.key}
            type="button"
            className={`docviewer-op-btn${activeOp === op.key ? ' docviewer-op-btn--active' : ''}`}
            title={op.label}
            disabled={busy}
            onClick={() => {
              if (!op.needsInput) {
                void runOperation(op.key)
                return
              }
              setActiveOp(prev => prev === op.key ? null : op.key)
              setInputValue(op.key === 'rotate' ? '90' : '')
              setError('')
            }}
          >
            {op.icon}
            <span>{op.label}</span>
          </button>
        ))}
      </div>

      {activeOp && (
        <div className="docviewer-ops-input">
          <input
            type="text"
            className="docviewer-ops-field"
            placeholder={ops.find(o => o.key === activeOp)?.needsInput || ''}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void runOperation(activeOp) }}
            disabled={busy}
            autoFocus
          />
          <button
            type="button"
            className="slack-button"
            disabled={busy}
            onClick={() => void runOperation(activeOp)}
          >
            {busy ? 'Processing…' : 'Run'}
          </button>
          <button type="button" className="ghost-button" onClick={() => { setActiveOp(null); setError('') }}>
            Cancel
          </button>
        </div>
      )}

      {error && <p className="docviewer-ops-error">{error}</p>}
    </div>
  )
}

// ── Main DocumentViewer ─────────────────────────────────────────────────────

interface DocumentViewerProps {
  /** Pre-signed or downloadable URL for the file */
  url: string
  /** Original filename */
  filename: string
  /** MIME type */
  mimeType?: string
  /** Document ID for operations */
  documentId?: string
  /** Workspace ID for operations */
  workspaceId?: string
  /** File size in bytes */
  fileSize?: number
  /** Current user ID (for signature workflows) */
  currentUserId?: string
  /** Close handler */
  onClose: () => void
  /** Called when a PDF operation creates a new document */
  onDocumentCreated?: (doc: { id: string; filename: string }) => void
}

export function DocumentViewer({
  url,
  filename,
  mimeType,
  documentId,
  workspaceId,
  fileSize,
  currentUserId,
  onClose,
  onDocumentCreated,
}: DocumentViewerProps) {
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [csvText, setCsvText] = useState<string | null>(null)
  const [textContent, setTextContent] = useState<string | null>(null)
  const [opsOpen, setOpsOpen] = useState(false)
  const [annotationsActive, setAnnotationsActive] = useState(false)
  const [signaturesOpen, setSignaturesOpen] = useState(false)
  const [formFieldsOpen, setFormFieldsOpen] = useState(false)
  const [redactionOpen, setRedactionOpen] = useState(false)
  const [assemblyOpen, setAssemblyOpen] = useState(false)
  const [convertedPdfUrl, setConvertedPdfUrl] = useState<string | null>(null)
  const [converting, setConverting] = useState(false)
  const [convertError, setConvertError] = useState('')
  const backdropRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const showImage = isImage(mimeType, filename)
  const showPdf = isPdf(mimeType, filename)
  const showCsv = isCsv(mimeType, filename)
  const showOffice = isOffice(mimeType, filename)
  const showText = isText(mimeType, filename)
  const showVideo = isVideo(mimeType, filename)
  const showAudio = isAudio(mimeType, filename)
  const showOps = (showPdf || showOffice) && documentId && workspaceId

  // Auto-convert Office documents to PDF
  useEffect(() => {
    if (!showOffice || !documentId) return
    setConverting(true)
    setConvertError('')
    void (async () => {
      try {
        const res = await apiFetch(`/api/documents/${encodeURIComponent(documentId)}/convert`, {
          method: 'POST',
        })
        if (res.ok) {
          const data = await res.json() as { document?: { id: string; url: string; filename: string } }
          if (data.document?.url) {
            setConvertedPdfUrl(data.document.url)
          }
        } else {
          const data = await res.json().catch(() => ({})) as { error?: string; detail?: string }
          setConvertError(data.detail || data.error || 'Conversion failed')
        }
      } catch (e) {
        setConvertError(e instanceof Error ? e.message : 'Conversion failed')
      }
      setConverting(false)
    })()
  }, [showOffice, documentId])

  // Load CSV/text content
  useEffect(() => {
    if (!showCsv && !showText) return
    void (async () => {
      try {
        const res = await fetch(url)
        if (res.ok) {
          const txt = await res.text()
          if (showCsv) setCsvText(txt)
          else setTextContent(txt)
        }
      } catch { /* ignore */ }
    })()
  }, [url, showCsv, showText])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if ((showImage || showPdf) && (e.key === '+' || e.key === '=')) setZoom(z => Math.min(z + 0.25, 4))
      if ((showImage || showPdf) && e.key === '-') setZoom(z => Math.max(z - 0.25, 0.25))
      if (showImage && e.key === 'r') setRotation(r => (r + 90) % 360)
      if (e.key === 'f') setFullscreen(f => !f)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, showImage, showPdf])

  const handleOpComplete = useCallback((newDoc: { id: string; filename: string }) => {
    onDocumentCreated?.(newDoc)
  }, [onDocumentCreated])

  if (typeof document === 'undefined') return null

  const ext = filename.split('.').pop()?.toLowerCase() || ''
  const fileTypeLabel = showPdf ? 'PDF Document'
    : showImage ? 'Image'
    : showCsv ? 'CSV Spreadsheet'
    : showOffice ? (ext === 'docx' || ext === 'doc' ? 'Word Document' : ext === 'xlsx' || ext === 'xls' ? 'Excel Spreadsheet' : 'Office Document')
    : showText ? 'Text File'
    : showVideo ? 'Video'
    : showAudio ? 'Audio'
    : 'File'

  return createPortal(
    <div
      ref={backdropRef}
      className={`docviewer-overlay${fullscreen ? ' docviewer-overlay--fullscreen' : ''}`}
      onClick={e => { if (e.target === backdropRef.current) onClose() }}
    >
      <div className="docviewer-chrome">
        {/* ── Toolbar ──────────────────────────────────────────── */}
        <div className="docviewer-toolbar">
          <div className="docviewer-toolbar-left">
            <span className="docviewer-filename" title={filename}>{filename}</span>
            <span className="docviewer-filetype">{fileTypeLabel}</span>
            {fileSize != null && <span className="docviewer-filesize">{formatBytes(fileSize)}</span>}
          </div>

          <div className="docviewer-toolbar-center">
            {(showImage || showPdf) && (
              <>
                <button type="button" className="mm-icon-btn" title="Zoom out (−)" onClick={() => setZoom(z => Math.max(z - 0.25, 0.25))}>
                  <ZoomOut size={16} />
                </button>
                <span className="docviewer-zoom-label">{Math.round(zoom * 100)}%</span>
                <button type="button" className="mm-icon-btn" title="Zoom in (+)" onClick={() => setZoom(z => Math.min(z + 0.25, 4))}>
                  <ZoomIn size={16} />
                </button>
              </>
            )}
            {showImage && (
              <button type="button" className="mm-icon-btn" title="Rotate (R)" onClick={() => setRotation(r => (r + 90) % 360)}>
                <RotateCw size={16} />
              </button>
            )}
          </div>

          <div className="docviewer-toolbar-right">
            {showOps && (
              <button
                type="button"
                className={`mm-icon-btn${opsOpen ? ' mm-icon-btn--active' : ''}`}
                title="PDF Operations"
                onClick={() => setOpsOpen(o => !o)}
              >
                <Layers size={16} />
              </button>
            )}
            {showPdf && documentId && workspaceId && (
              <button
                type="button"
                className={`mm-icon-btn${formFieldsOpen ? ' mm-icon-btn--active' : ''}`}
                title="Form Fields"
                onClick={() => setFormFieldsOpen(f => !f)}
              >
                <FileInput size={16} />
              </button>
            )}
            {showPdf && documentId && workspaceId && (
              <button
                type="button"
                className={`mm-icon-btn${redactionOpen ? ' mm-icon-btn--active' : ''}`}
                title="Secure Redaction"
                onClick={() => setRedactionOpen(r => !r)}
              >
                <Shield size={16} />
              </button>
            )}
            {documentId && (showPdf || showImage) && (
              <button
                type="button"
                className={`mm-icon-btn${annotationsActive ? ' mm-icon-btn--active' : ''}`}
                title="Annotations"
                onClick={() => setAnnotationsActive(a => !a)}
              >
                <Highlighter size={16} />
              </button>
            )}
            {documentId && workspaceId && currentUserId && (
              <button
                type="button"
                className={`mm-icon-btn${signaturesOpen ? ' mm-icon-btn--active' : ''}`}
                title="Signatures"
                onClick={() => setSignaturesOpen(s => !s)}
              >
                <PenTool size={16} />
              </button>
            )}
            {workspaceId && (
              <button
                type="button"
                className={`mm-icon-btn${assemblyOpen ? ' mm-icon-btn--active' : ''}`}
                title="Document Assembly"
                onClick={() => setAssemblyOpen(a => !a)}
              >
                <Layers size={16} />
              </button>
            )}
            {documentId && (
              <button
                type="button"
                className={`mm-icon-btn${versionsOpen ? ' mm-icon-btn--active' : ''}`}
                title="Version history"
                onClick={() => setVersionsOpen(o => !o)}
              >
                <History size={16} />
              </button>
            )}
            <button type="button" className="mm-icon-btn" title="Toggle fullscreen (F)" onClick={() => setFullscreen(f => !f)}>
              {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <a href={url} download={filename} className="mm-icon-btn" title="Download">
              <Download size={16} />
            </a>
            <button type="button" className="mm-icon-btn" onClick={onClose} title="Close (Esc)">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── PDF Operations Bar ───────────────────────────────── */}
        {opsOpen && documentId && workspaceId && (
          <PdfOperationsToolbar
            documentId={documentId}
            workspaceId={workspaceId}
            filename={filename}
            canConvert={showOffice}
            onOperationComplete={handleOpComplete}
          />
        )}

        {/* ── Content Area ─────────────────────────────────────── */}
        <div className="docviewer-content" ref={contentRef}>
          {showImage ? (
            <div className="docviewer-image-wrap">
              <img
                src={url}
                alt={filename}
                className="docviewer-image"
                style={{
                  transform: `scale(${zoom}) rotate(${rotation}deg)`,
                  transition: 'transform 0.2s ease'
                }}
                draggable={false}
              />
            </div>
          ) : showPdf ? (
            <iframe
              src={`${url}#zoom=${Math.round(zoom * 100)}`}
              className="docviewer-pdf"
              title={filename}
            />
          ) : showCsv && csvText != null ? (
            <CsvViewer text={csvText} />
          ) : showText && textContent != null ? (
            <div className="docviewer-text">
              <pre>{textContent}</pre>
            </div>
          ) : showVideo ? (
            <div className="docviewer-media-wrap">
              <video controls src={url} className="docviewer-video">
                Your browser does not support the video tag.
              </video>
            </div>
          ) : showAudio ? (
            <div className="docviewer-media-wrap">
              <audio controls src={url} className="docviewer-audio">
                Your browser does not support the audio element.
              </audio>
            </div>
          ) : showOffice ? (
            convertedPdfUrl ? (
              <iframe
                src={`${convertedPdfUrl}#zoom=${Math.round(zoom * 100)}`}
                className="docviewer-pdf"
                title={filename}
              />
            ) : converting ? (
              <div className="docviewer-unsupported">
                <Loader2 size={48} strokeWidth={1.5} className="spin" />
                <h3>Converting to PDF…</h3>
                <p>Please wait while the document is being converted for preview.</p>
              </div>
            ) : (
              <div className="docviewer-unsupported">
                <FileText size={48} strokeWidth={1.5} />
                <h3>{filename}</h3>
                {convertError ? (
                  <p className="docviewer-convert-error">{convertError}</p>
                ) : (
                  <p>Office documents can be viewed after converting to PDF.</p>
                )}
                {documentId && workspaceId && (
                  <button
                    type="button"
                    className="slack-button"
                    onClick={() => { setOpsOpen(true) }}
                  >
                    <FileOutput size={14} /> Convert to PDF manually
                  </button>
                )}
                <a href={url} download={filename} className="ghost-button" style={{ marginTop: 8 }}>
                  <Download size={14} /> Download {filename}
                </a>
              </div>
            )
          ) : (
            <div className="docviewer-unsupported">
              <FileText size={48} strokeWidth={1.5} />
              <h3>Preview not available</h3>
              <p>This file type cannot be previewed in the browser.</p>
              <a href={url} download={filename} className="slack-button" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Download size={14} /> Download {filename}
              </a>
            </div>
          )}

          {/* Annotation Overlay */}
          {annotationsActive && documentId && contentRef.current && (
            <AnnotationOverlay
              documentId={documentId}
              pageNumber={1}
              contentWidth={contentRef.current.clientWidth}
              contentHeight={contentRef.current.clientHeight}
              active={annotationsActive}
            />
          )}
        </div>

        {/* ── Version History Sidebar ──────────────────────────── */}
        {documentId && (
          <VersionHistoryPanel
            documentId={documentId}
            open={versionsOpen}
            onClose={() => setVersionsOpen(false)}
            onSelectVersion={(v) => {
              // Navigate to version download
              const versionUrl = `/api/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(v.id)}/download`
              window.open(versionUrl, '_blank')
            }}
          />
        )}

        {/* ── Signature Sidebar ──────────────────────────────────── */}
        {documentId && workspaceId && currentUserId && (
          <SignaturePanel
            documentId={documentId}
            workspaceId={workspaceId}
            currentUserId={currentUserId}
            open={signaturesOpen}
            onClose={() => setSignaturesOpen(false)}
          />
        )}

        {/* ── Form Fields Panel ─────────────────────────────────── */}
        {documentId && workspaceId && (
          <PdfFormFieldsPanel
            documentId={documentId}
            workspaceId={workspaceId}
            open={formFieldsOpen}
            onClose={() => setFormFieldsOpen(false)}
            onOperationComplete={handleOpComplete}
          />
        )}

        {/* ── Redaction Panel ──────────────────────────────────── */}
        {documentId && workspaceId && (
          <RedactionPanel
            documentId={documentId}
            workspaceId={workspaceId}
            open={redactionOpen}
            onClose={() => setRedactionOpen(false)}
            onOperationComplete={handleOpComplete}
          />
        )}

        {/* ── Document Assembly (Puzzle Box) ──────────────────────── */}
        {assemblyOpen && workspaceId && (
          <AssemblyIngestModal
            workspaceId={workspaceId}
            onClose={() => setAssemblyOpen(false)}
            onCreated={() => {
              // Pipeline runs server-side; the Files list re-fetches on next mount.
              setAssemblyOpen(false)
            }}
          />
        )}
      </div>
    </div>,
    document.body
  )
}
