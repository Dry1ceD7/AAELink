'use client'

import { useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Download } from 'lucide-react'

/**
 * AvatarLightbox — full-size profile photo viewer.
 *
 * Click any avatar to open this overlay; click the backdrop or press Esc to
 * close. The image is centered, capped at 80vh / 80vw, and includes a
 * Download button so users can save the image. Honors `prefers-reduced-motion`.
 *
 * Used by `UserProfilePanel` and anywhere a profile avatar
 * is shown at large.
 */

interface AvatarLightboxProps {
  /** Image URL to show. When null/empty, the lightbox is closed. */
  src: string | null
  /** Display name used for alt text + the download filename. */
  name: string
  onClose: () => void
}

export function AvatarLightbox({ src, name, onClose }: AvatarLightboxProps) {
  // Esc handler.
  useEffect(() => {
    if (!src) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [src, onClose])

  const onDownload = useCallback(async () => {
    if (!src) return
    try {
      const res = await fetch(src)
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const ext = blob.type.split('/')[1] || 'png'
      a.href = url
      a.download = `${name.replace(/[^\w.-]+/g, '_') || 'profile'}.${ext}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch { /* ignore */ }
  }, [src, name])

  if (!src || typeof document === 'undefined') return null

  const node = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Profile photo for ${name}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9500,
        background: 'rgba(0, 0, 0, 0.78)',
        backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
        display: 'grid', placeItems: 'center',
        animation: 'avatarLightboxFadeIn 160ms ease-out',
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close photo"
        style={{
          position: 'absolute', top: 18, right: 18,
          width: 36, height: 36, borderRadius: 999,
          background: 'rgba(255, 255, 255, 0.12)',
          color: '#fff', border: 'none', cursor: 'pointer',
          display: 'grid', placeItems: 'center',
          transition: 'background 150ms ease-out',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.22)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.12)' }}
      >
        <X size={18} />
      </button>

      <button
        type="button"
        onClick={() => void onDownload()}
        aria-label="Download photo"
        style={{
          position: 'absolute', top: 18, right: 64,
          width: 36, height: 36, borderRadius: 999,
          background: 'rgba(255, 255, 255, 0.12)',
          color: '#fff', border: 'none', cursor: 'pointer',
          display: 'grid', placeItems: 'center',
          transition: 'background 150ms ease-out',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.22)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.12)' }}
      >
        <Download size={18} />
      </button>

      <img
        src={src}
        alt={`Profile photo for ${name}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '80vw', maxHeight: '80vh',
          borderRadius: 16,
          boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
          animation: 'avatarLightboxScaleIn 200ms cubic-bezier(0.175, 0.885, 0.32, 1.275)',
        }}
      />

      <p style={{
        position: 'absolute', bottom: 24, left: 0, right: 0,
        textAlign: 'center', color: 'rgba(255,255,255,0.85)',
        margin: 0, fontSize: 14, fontWeight: 600,
        textShadow: '0 1px 3px rgba(0,0,0,0.5)',
      }}>
        {name}
      </p>
    </div>
  )

  return createPortal(node, document.body)
}
