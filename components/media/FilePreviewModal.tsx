'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, X, ZoomIn, ZoomOut, RotateCw } from 'lucide-react'

interface Props {
  url: string
  filename: string
  mimeType?: string
  onClose: () => void
}

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

export function FilePreviewModal({ url, filename, mimeType, onClose }: Props) {
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const backdropRef = useRef<HTMLDivElement>(null)

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

  const showImage = isImage(mimeType, filename)
  const showPdf = isPdf(mimeType, filename)

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
          ) : (
            <div className="file-preview-unsupported">
              <p>Preview not available for this file type.</p>
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
