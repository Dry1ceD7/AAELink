'use client'

import { memo, useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Download, ZoomIn, ZoomOut, RotateCw } from 'lucide-react'

interface Props {
  src: string
  alt: string
  onClose: () => void
}

/**
 * ImageLightbox — Slack-style full-screen image viewer.
 * Click image → overlay with zoom controls, download, rotate, ESC to close.
 */
export const ImageLightbox = memo(function ImageLightbox({ src, alt, onClose }: Props) {
  const [scale, setScale] = useState(1)
  const [rotation, setRotation] = useState(0)

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    if (e.key === '+' || e.key === '=') setScale(s => Math.min(s + 0.25, 4))
    if (e.key === '-') setScale(s => Math.max(s - 0.25, 0.25))
    if (e.key === '0') { setScale(1); setRotation(0) }
  }, [onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [handleKeyDown])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="lightbox-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      onClick={onClose}
    >
      {/* Toolbar */}
      <div className="lightbox-toolbar" onClick={e => e.stopPropagation()}>
        <span className="lightbox-filename">{alt}</span>
        <div className="lightbox-controls">
          <button type="button" className="lightbox-btn" onClick={() => setScale(s => Math.min(s + 0.25, 4))} title="Zoom in">
            <ZoomIn size={18} />
          </button>
          <span className="lightbox-zoom-label">{Math.round(scale * 100)}%</span>
          <button type="button" className="lightbox-btn" onClick={() => setScale(s => Math.max(s - 0.25, 0.25))} title="Zoom out">
            <ZoomOut size={18} />
          </button>
          <button type="button" className="lightbox-btn" onClick={() => setRotation(r => r + 90)} title="Rotate">
            <RotateCw size={18} />
          </button>
          <div className="lightbox-divider" />
          <a href={src} download={alt} className="lightbox-btn" title="Download" onClick={e => e.stopPropagation()}>
            <Download size={18} />
          </a>
          <button type="button" className="lightbox-btn lightbox-close" onClick={onClose} title="Close (Esc)">
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Image */}
      <div className="lightbox-image-container" onClick={e => e.stopPropagation()}>
        <img
          src={src}
          alt={alt}
          className="lightbox-image"
          style={{
            transform: `scale(${scale}) rotate(${rotation}deg)`,
            transition: 'transform 0.2s ease'
          }}
          draggable={false}
        />
      </div>
    </div>,
    document.body
  )
})
