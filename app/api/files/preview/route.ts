import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * File Preview API — metadata, thumbnails, and inline preview support.
 *
 * GET /api/files/preview?file_id=...
 *
 * Returns preview metadata for a file:
 *   - Content type / MIME detection
 *   - Thumbnail URL (for images)
 *   - Preview-able flag (images, PDFs, videos, audio, text)
 *   - Dimensions (width/height for images/video)
 *   - Duration (for audio/video)
 *   - File size and format
 *
 * Powers inline previews in message attachments and file browser.
 */

const PREVIEWABLE_TYPES: Record<string, string> = {
  // Images
  'image/jpeg': 'image', 'image/png': 'image', 'image/gif': 'image',
  'image/webp': 'image', 'image/svg+xml': 'image', 'image/bmp': 'image',
  // Video
  'video/mp4': 'video', 'video/webm': 'video', 'video/ogg': 'video',
  'video/quicktime': 'video',
  // Audio
  'audio/mpeg': 'audio', 'audio/ogg': 'audio', 'audio/wav': 'audio',
  'audio/webm': 'audio', 'audio/aac': 'audio',
  // Documents
  'application/pdf': 'pdf',
  'text/plain': 'text', 'text/markdown': 'text', 'text/csv': 'text',
  'text/html': 'text', 'text/css': 'text', 'text/javascript': 'text',
  'application/json': 'text', 'application/xml': 'text',
  // Code
  'text/x-python': 'code', 'text/x-java': 'code', 'text/x-go': 'code',
  'text/x-typescript': 'code', 'text/x-c': 'code',
}

function getPreviewCategory(contentType: string): string | null {
  return PREVIEWABLE_TYPES[contentType] || null
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const fileId = req.nextUrl.searchParams.get('file_id')?.trim() || ''
  if (!fileId) return NextResponse.json({ error: 'file_id_required' }, { status: 400 })

  // Fetch file metadata
  const { rows } = await pool.query<{
    id: string; name: string; content_type: string; size_bytes: string
    storage_key: string; workspace_id: string; uploaded_by: string
    width: string | null; height: string | null; duration_ms: string | null
    thumbnail_key: string | null; created_at: string
  }>(`
    SELECT id, name, content_type, size_bytes, storage_key, workspace_id,
           uploaded_by, width, height, duration_ms, thumbnail_key, created_at
    FROM aaelink.file_uploads
    WHERE id = $1
  `, [fileId])

  if (!rows[0]) return NextResponse.json({ error: 'file_not_found' }, { status: 404 })
  const file = rows[0]

  const previewCategory = getPreviewCategory(file.content_type)
  const isPreviewable = previewCategory !== null
  const extension = file.name.split('.').pop()?.toLowerCase() || ''

  // Build preview URLs
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || ''
  const fileUrl = `${baseUrl}/api/files/download?file_id=${fileId}`
  const thumbnailUrl = file.thumbnail_key
    ? `${baseUrl}/api/files/download?file_id=${fileId}&thumbnail=true`
    : (previewCategory === 'image' ? fileUrl : null)

  return NextResponse.json({
    preview: {
      file_id: file.id,
      name: file.name,
      extension,
      content_type: file.content_type,
      size_bytes: Number(file.size_bytes),
      size_formatted: formatFileSize(Number(file.size_bytes)),

      // Preview capabilities
      is_previewable: isPreviewable,
      preview_category: previewCategory,

      // Media dimensions
      width: file.width ? Number(file.width) : null,
      height: file.height ? Number(file.height) : null,
      duration_ms: file.duration_ms ? Number(file.duration_ms) : null,

      // URLs
      file_url: fileUrl,
      thumbnail_url: thumbnailUrl,
      inline_url: isPreviewable ? fileUrl : null,

      // Metadata
      uploaded_by: file.uploaded_by,
      workspace_id: file.workspace_id,
      created_at: Number(file.created_at),

      // Rendering hints for the client
      render_hints: {
        can_inline: previewCategory === 'image' || previewCategory === 'video' || previewCategory === 'audio',
        can_lightbox: previewCategory === 'image',
        can_player: previewCategory === 'video' || previewCategory === 'audio',
        can_code_highlight: previewCategory === 'code' || previewCategory === 'text',
        can_pdf_viewer: previewCategory === 'pdf',
        needs_download: !isPreviewable,
      }
    }
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/files/preview', _GET)
