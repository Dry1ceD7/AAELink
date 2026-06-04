// keep: slack-compat surface (intentionally addressable, may be invoked by Slack-shaped clients)
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

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

  // Fetch file metadata. Canonical table: aaelink.file_attachments
  // (migration 033). The legacy `aaelink.file_uploads` table this route used
  // never existed in the migration runner, so preview returned file_not_found
  // for every real upload. Soft-deleted rows are excluded.
  const { rows } = await pool.query<{
    id: string; filename: string; content_type: string; size: string
    storage_key: string; workspace_id: string | null; user_id: string
    width: string | null; height: string | null; duration_ms: string | null
    thumbnail_key: string | null; created_at: string
  }>(`
    SELECT id, filename, content_type, size, storage_key, workspace_id,
           user_id, width, height, duration_ms, thumbnail_key, created_at
    FROM aaelink.file_attachments
    WHERE id = $1 AND deleted_at = 0
  `, [fileId])

  if (!rows[0]) return NextResponse.json({ error: 'file_not_found' }, { status: 404 })
  const file = rows[0]

  const previewCategory = getPreviewCategory(file.content_type)
  const isPreviewable = previewCategory !== null
  const extension = file.filename.split('.').pop()?.toLowerCase() || ''

  // Build preview URLs from the canonical download route (/api/files/:id/download).
  // The legacy /api/files/download?file_id= path has no handler. The download
  // route does not honor a thumbnail param yet, so the thumbnail URL falls back
  // to the full file for images (no dedicated thumbnail endpoint exists).
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || ''
  const fileUrl = `${baseUrl}/api/files/${fileId}/download`
  const thumbnailUrl = previewCategory === 'image' ? fileUrl : null

  return NextResponse.json({
    preview: {
      file_id: file.id,
      name: file.filename,
      extension,
      content_type: file.content_type,
      size_bytes: Number(file.size),
      size_formatted: formatFileSize(Number(file.size)),

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
      uploaded_by: file.user_id,
      workspace_id: file.workspace_id || '',
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
