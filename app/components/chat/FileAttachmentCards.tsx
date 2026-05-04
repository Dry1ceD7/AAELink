'use client'

import { memo } from 'react'
import { Download, FileText, FileSpreadsheet, FileImage, Film, Music, Archive, File } from 'lucide-react'
import type { FileAttachment } from '@/lib/realtime'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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

interface Props {
  attachments: FileAttachment[]
}

export const FileAttachmentCards = memo(function FileAttachmentCards({ attachments }: Props) {
  if (!attachments || attachments.length === 0) return null

  // Separate image attachments (rendered inline) from file cards
  const images = attachments.filter(a => a.mime_type.startsWith('image/'))
  const files = attachments.filter(a => !a.mime_type.startsWith('image/'))

  return (
    <div className="file-attachments">
      {/* Inline image previews */}
      {images.length > 0 && (
        <div className="file-attachment-images">
          {images.map(img => (
            <a
              key={img.id}
              href={img.url}
              target="_blank"
              rel="noopener noreferrer"
              className="file-attachment-image-link"
            >
              <img
                src={img.url}
                alt={img.name}
                className="file-attachment-image"
                loading="lazy"
              />
              <span className="file-attachment-image-name">{img.name}</span>
            </a>
          ))}
        </div>
      )}

      {/* File cards for non-image attachments */}
      {files.length > 0 && (
        <div className="file-attachment-cards">
          {files.map(file => (
            <a
              key={file.id}
              href={file.url}
              target="_blank"
              rel="noopener noreferrer"
              className="file-attachment-card"
              download={file.name}
            >
              <div className="file-attachment-card-icon" style={{ color: getMimeColor(file.mime_type) }}>
                {getMimeIcon(file.mime_type)}
              </div>
              <div className="file-attachment-card-meta">
                <span className="file-attachment-card-name">{file.name}</span>
                <span className="file-attachment-card-size">
                  {formatSize(file.size)} · {file.mime_type.split('/').pop()?.toUpperCase()}
                </span>
              </div>
              <div className="file-attachment-card-dl">
                <Download size={14} />
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
})
