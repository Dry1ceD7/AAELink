'use client'

import { memo, useState } from 'react'
import { Download, FileText, FileSpreadsheet, FileImage, Film, Music, Archive, File } from 'lucide-react'
import type { FileAttachment } from '@/lib/realtime/realtime'
import { ImageLightbox } from './ImageLightbox'
import { FileDetailsPanel } from '@/components/media/FileDetailsPanel'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function relativeDate(ms?: number): string {
  if (!ms) return ''
  const diff = Date.now() - ms
  const min = Math.round(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 7) return `${day}d ago`
  return new Date(ms).toLocaleDateString()
}

function getMimeIcon(mime: string) {
  if (mime.startsWith('image/')) return <FileImage size={20} />
  if (mime.startsWith('video/')) return <Film size={20} />
  if (mime.startsWith('audio/')) return <Music size={20} />
  if (mime === 'application/pdf' || mime.includes('document') || mime.includes('word')) return <FileText size={20} />
  if (mime.includes('sheet') || mime.includes('excel') || mime === 'text/csv') return <FileSpreadsheet size={20} />
  if (mime.includes('zip') || mime.includes('tar') || mime.includes('rar') || mime.includes('7z')) return <Archive size={20} />
  return <File size={20} />
}

function getMimeColor(mime: string): string {
  if (mime.startsWith('image/')) return '#4a90d9'
  if (mime.startsWith('video/')) return '#9b59b6'
  if (mime.startsWith('audio/')) return '#e67e22'
  if (mime === 'application/pdf') return '#e74c3c'
  if (mime.includes('sheet') || mime.includes('excel')) return '#27ae60'
  if (mime.includes('document') || mime.includes('word')) return '#2980b9'
  if (mime.includes('zip') || mime.includes('tar')) return '#7f8c8d'
  return '#95a5a6'
}

/** Short, uppercase type badge from a MIME type (e.g. application/pdf → PDF). */
function typeBadge(mime: string): string {
  return (mime.split('/').pop() || mime).split(/[.+]/).pop()!.toUpperCase()
}

/** Only these MIME families get a server-generated thumbnail (file_thumbnail worker). */
function hasThumbnail(mime: string): boolean {
  return mime.startsWith('video/') || mime === 'application/pdf'
}

interface Props {
  attachments: FileAttachment[]
  /** Optional uploader display name (message-level) for the metadata row. */
  uploaderName?: string
  /** Optional upload time (ms) for the relative-date metadata row. */
  uploadedAt?: number
  /** Viewer id — forwarded to the details panel to gate delete. */
  currentUserId?: string
  /** True when the viewer is a platform admin. */
  isAdmin?: boolean
  /** Called when a file is deleted from the details panel. */
  onFileDeleted?: (fileId: string) => void
}

export const FileAttachmentCards = memo(function FileAttachmentCards({
  attachments, uploaderName, uploadedAt, currentUserId, isAdmin, onFileDeleted,
}: Props) {
  const [lightboxImg, setLightboxImg] = useState<{ src: string; alt: string } | null>(null)
  const [detailsId, setDetailsId] = useState<string | null>(null)

  if (!attachments || attachments.length === 0) return null

  // Separate image attachments (rendered inline) from file cards
  const images = attachments.filter(a => a.mime_type.startsWith('image/'))
  const files = attachments.filter(a => !a.mime_type.startsWith('image/'))

  const metaRow = (uploaderName || uploadedAt)
    ? [uploaderName, relativeDate(uploadedAt)].filter(Boolean).join(' · ')
    : ''

  return (
    <div className="file-attachments">
      {/* Inline image previews — click to open lightbox */}
      {images.length > 0 && (
        <div className="file-attachment-images">
          {images.map(img => (
            <button
              key={img.id}
              type="button"
              className="file-attachment-image-link"
              onClick={() => setLightboxImg({ src: img.url, alt: img.name })}
            >
              <img
                src={img.url}
                alt={img.name}
                className="file-attachment-image"
                loading="lazy"
              />
              <span className="file-attachment-image-name">{img.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* File cards for non-image attachments — click opens the details panel */}
      {files.length > 0 && (
        <div className="file-attachment-cards">
          {files.map(file => (
            <div
              key={file.id}
              role="button"
              tabIndex={0}
              className="file-attachment-card"
              onClick={() => setDetailsId(file.id)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailsId(file.id) } }}
              style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }}
            >
              {/* Thumbnail (server-generated) with an icon fallback. */}
              <div className="file-attachment-card-icon" style={{ color: getMimeColor(file.mime_type), position: 'relative', overflow: 'hidden' }}>
                {hasThumbnail(file.mime_type) && (
                  <img
                    src={`/api/files/preview?file_id=${encodeURIComponent(file.id)}&thumb=1`}
                    alt=""
                    loading="lazy"
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6 }}
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                  />
                )}
                <span style={{ position: 'relative' }}>{getMimeIcon(file.mime_type)}</span>
              </div>
              <div className="file-attachment-card-meta">
                <span className="file-attachment-card-name">{file.name}</span>
                <span className="file-attachment-card-size">
                  <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: getMimeColor(file.mime_type), color: '#fff', marginRight: 6 }}>
                    {typeBadge(file.mime_type)}
                  </span>
                  {formatSize(file.size)}
                </span>
                {metaRow && <span className="file-attachment-card-size" style={{ opacity: 0.7 }}>{metaRow}</span>}
              </div>
              <a
                href={file.url}
                target="_blank"
                rel="noopener noreferrer"
                download={file.name}
                className="file-attachment-card-dl"
                onClick={e => e.stopPropagation()}
                aria-label={`Download ${file.name}`}
              >
                <Download size={14} />
              </a>
            </div>
          ))}
        </div>
      )}

      {/* Image Lightbox */}
      {lightboxImg && (
        <ImageLightbox
          src={lightboxImg.src}
          alt={lightboxImg.alt}
          onClose={() => setLightboxImg(null)}
        />
      )}

      {/* File details panel (overlay) */}
      {detailsId && (
        <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 360, maxWidth: '100vw', zIndex: 1100, boxShadow: '-2px 0 12px rgba(0,0,0,0.2)', background: 'var(--mm-main-bg)' }}>
          <FileDetailsPanel
            fileId={detailsId}
            currentUserId={currentUserId || ''}
            isAdmin={isAdmin}
            onClose={() => setDetailsId(null)}
            onDeleted={id => { setDetailsId(null); onFileDeleted?.(id) }}
          />
        </div>
      )}
    </div>
  )
})
