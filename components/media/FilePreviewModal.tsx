'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, X, ZoomIn, ZoomOut, RotateCw } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import { CodePreview } from './CodePreview'

interface Props {
  url: string
  filename: string
  mimeType?: string
  onClose: () => void
}

const CODE_EXTS = new Set([
  'txt', 'md', 'markdown', 'csv', 'html', 'htm', 'css', 'js', 'jsx', 'mjs', 'cjs',
  'ts', 'tsx', 'json', 'xml', 'yml', 'yaml', 'py', 'java', 'go', 'rs', 'c', 'h',
  'cpp', 'cc', 'hpp', 'cs', 'rb', 'php', 'sh', 'bash', 'zsh', 'sql', 'toml', 'ini',
  'env', 'log', 'swift', 'kt', 'scala', 'pl', 'lua', 'r', 'dart', 'vue', 'svelte',
])

const OFFICE_EXTS = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf'])

const OFFICE_MIMES = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/rtf',
])

function ext(name?: string): string {
  return name?.split('.').pop()?.toLowerCase() || ''
}

function isImage(mime?: string, name?: string): boolean {
  if (mime?.startsWith('image/')) return true
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext(name))
}

function isPdf(mime?: string, name?: string): boolean {
  if (mime === 'application/pdf') return true
  if (name?.toLowerCase().endsWith('.pdf')) return true
  return false
}

function isVideo(mime?: string, name?: string): boolean {
  if (mime?.startsWith('video/')) return true
  return ['mp4', 'webm', 'ogv', 'mov', 'm4v'].includes(ext(name))
}

function isAudio(mime?: string, name?: string): boolean {
  if (mime?.startsWith('audio/')) return true
  return ['mp3', 'ogg', 'oga', 'wav', 'aac', 'm4a', 'flac'].includes(ext(name))
}

function isCode(mime?: string, name?: string): boolean {
  if (mime?.startsWith('text/')) return true
  if (mime === 'application/json' || mime === 'application/xml') return true
  if (mime?.startsWith('application/') && mime.includes('+xml')) return true
  return CODE_EXTS.has(ext(name))
}

function isOffice(mime?: string, name?: string): boolean {
  if (mime && OFFICE_MIMES.has(mime)) return true
  return OFFICE_EXTS.has(ext(name))
}

// The convert route operates on aaelink.documents and needs the document id.
// The modal only receives a URL, so derive the id from the canonical
// /api/documents/:id/download shape. Returns '' when the URL is not a
// documents-route URL (e.g. a file_attachments download) — office conversion
// is unavailable in that case and we fall back to download.
function documentIdFromUrl(url: string): string {
  const m = url.match(/\/api\/documents\/([^/]+)\/download/)
  return m?.[1] || ''
}

export function FilePreviewModal({ url, filename, mimeType, onClose }: Props) {
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const backdropRef = useRef<HTMLDivElement>(null)

  const showImage = isImage(mimeType, filename)
  const showPdf = isPdf(mimeType, filename)
  const showVideo = !showImage && !showPdf && isVideo(mimeType, filename)
  const showAudio = !showImage && !showPdf && !showVideo && isAudio(mimeType, filename)
  const showCode = !showImage && !showPdf && !showVideo && !showAudio && isCode(mimeType, filename)
  const showOffice = !showImage && !showPdf && !showVideo && !showAudio && !showCode && isOffice(mimeType, filename)

  // Office conversion: ask the documents convert route for a PDF, then render
  // it through the existing PDF iframe path.
  const [convertedPdfUrl, setConvertedPdfUrl] = useState<string>('')
  const [officeState, setOfficeState] = useState<'idle' | 'loading' | 'error'>('idle')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === '+' || e.key === '=') setZoom(z => Math.min(z + 0.25, 3))
      if (e.key === '-') setZoom(z => Math.max(z - 0.25, 0.25))
      if (e.key === 'r') setRotation(r => (r + 90) % 360)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!showOffice) return
    const docId = documentIdFromUrl(url)
    if (!docId) { setOfficeState('error'); return }
    let cancelled = false
    setOfficeState('loading')
    apiFetch(`/api/documents/${docId}/convert`, { method: 'POST' })
      .then(async res => {
        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.document?.url) throw new Error('conversion_failed')
        return data.document.url as string
      })
      .then(pdfUrl => { if (!cancelled) { setConvertedPdfUrl(pdfUrl); setOfficeState('idle') } })
      .catch(() => { if (!cancelled) setOfficeState('error') })
    return () => { cancelled = true }
  }, [showOffice, url])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div ref={backdropRef} className="file-preview-overlay"
      onClick={e => { if (e.target === backdropRef.current) onClose() }}>
      <div className="file-preview-chrome">
        <div className="file-preview-toolbar">
          <span className="file-preview-filename">{filename}</span>
          <div className="file-preview-actions">
            {showImage && (
              <>
                <button type="button" className="mm-icon-btn" title="Zoom in" onClick={() => setZoom(z => Math.min(z + 0.25, 3))}>
                  <ZoomIn size={16} />
                </button>
                <button type="button" className="mm-icon-btn" title="Zoom out" onClick={() => setZoom(z => Math.max(z - 0.25, 0.25))}>
                  <ZoomOut size={16} />
                </button>
                <button type="button" className="mm-icon-btn" title="Rotate" onClick={() => setRotation(r => (r + 90) % 360)}>
                  <RotateCw size={16} />
                </button>
                <span className="file-preview-zoom-label">{Math.round(zoom * 100)}%</span>
              </>
            )}
            <a href={url} download={filename} className="mm-icon-btn" title="Download">
              <Download size={16} />
            </a>
            <button type="button" className="mm-icon-btn" onClick={onClose} title="Close">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="file-preview-content">
          {showImage ? (
            <img
              src={url}
              alt={filename}
              className="file-preview-image"
              style={{
                transform: `scale(${zoom}) rotate(${rotation}deg)`,
                transition: 'transform 0.2s ease'
              }}
              draggable={false}
            />
          ) : showPdf ? (
            <iframe
              src={url}
              className="file-preview-pdf"
              title={filename}
            />
          ) : showVideo ? (
            <video
              src={url}
              controls
              autoPlay={false}
              style={{ maxWidth: '100%', maxHeight: '100%', outline: 'none' }}
            >
              <track kind="captions" />
            </video>
          ) : showAudio ? (
            <audio src={url} controls style={{ width: '80%', maxWidth: 480 }}>
              <track kind="captions" />
            </audio>
          ) : showCode ? (
            <CodePreview url={url} mime={mimeType} filename={filename} />
          ) : showOffice && officeState === 'loading' ? (
            <div className="file-preview-unsupported">
              <p>Converting {filename} to PDF...</p>
            </div>
          ) : showOffice && convertedPdfUrl ? (
            <iframe
              src={convertedPdfUrl}
              className="file-preview-pdf"
              title={filename}
            />
          ) : (
            <div className="file-preview-unsupported">
              <p>
                {showOffice && officeState === 'error'
                  ? 'Could not convert this document for preview.'
                  : 'Preview not available for this file type.'}
              </p>
              <a href={url} download={filename} className="slack-button" style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Download size={14} /> Download {filename}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
