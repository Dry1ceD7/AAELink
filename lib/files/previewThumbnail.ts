/**
 * Thumbnail-serving helper for GET /api/files/preview?thumb=1.
 *
 * Resolves a file's generated thumbnail bytes (file_attachments.thumbnail_key,
 * populated by the file_thumbnail worker job) and returns them with safe serving
 * headers — but ONLY after the same access checks the full-download path applies:
 *   - uploader, or channel-read access for channel-attached files (others 403),
 *   - the D12 virus-scan gate (never serve an infected/blocked file).
 *
 * Extracted from the preview route so that file stays under the ~250-line cap
 * and the thumbnail path reuses the canonical ACL + scan-gate logic rather than
 * re-implementing it.
 */
import { NextResponse } from 'next/server'
import type { Pool } from 'pg'
import { userCanReadChannel } from '@/lib/enterprise/collab-access'
import { isFileAccessAllowed } from '@/lib/files/scanGate'
import { readFileBytes } from '@/lib/files/storage'
import { buildServeHeaders } from '@/lib/files/serveHeaders'

/**
 * Serve a file's thumbnail bytes (or an appropriate error response). The caller
 * has already resolved auth (uid) and the pool. Mirrors the download route's
 * access model exactly, then serves the thumbnail as inline image/webp.
 */
export async function serveThumbnail(
  pool: Pool,
  uid: string,
  fileId: string
): Promise<NextResponse> {
  const { rows } = await pool.query<{
    storage_backend: string | null
    thumbnail_key: string | null
    user_id: string
    channel_id: string | null
    deleted_at: string
  }>(
    `SELECT storage_backend, thumbnail_key, user_id, channel_id, deleted_at::text AS deleted_at
       FROM aaelink.file_attachments WHERE id = $1`,
    [fileId]
  )
  const att = rows[0]
  if (!att || Number(att.deleted_at) !== 0) {
    return NextResponse.json({ error: 'file_not_found' }, { status: 404 })
  }

  // Access: uploader always; channel-attached files require channel read; an
  // unattached upload is private to its uploader until shared.
  if (att.user_id !== uid) {
    const allowed = att.channel_id
      ? await userCanReadChannel(pool, uid, att.channel_id)
      : false
    if (!allowed) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Virus-scan gate (D12) applies to the derived thumbnail too.
  if (!(await isFileAccessAllowed(pool, fileId))) {
    return NextResponse.json({ error: 'file_blocked_by_scan' }, { status: 403 })
  }

  // No thumbnail generated (not an image, sharp unavailable, or not yet
  // processed) → 404 so the client falls back to the full image.
  if (!att.thumbnail_key) {
    return NextResponse.json({ error: 'thumbnail_not_found' }, { status: 404 })
  }

  const buffer = await readFileBytes(att.thumbnail_key, att.storage_backend)
  if (!buffer) {
    return NextResponse.json({ error: 'thumbnail_missing' }, { status: 404 })
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: buildServeHeaders({
      contentType: 'image/webp',
      filename: `${fileId}.thumb.webp`,
      size: buffer.length,
      cacheControl: 'private, max-age=86400',
    }),
  })
}
