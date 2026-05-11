import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Media Playback Policy API — file playback controls.
 *
 * GET /api/admin/media-policy — get current media playback policies
 * PUT /api/admin/media-policy — update media policies (admin only)
 *
 * Controls:
 *   - Auto-play behavior for videos/audio
 *   - Max file size for inline preview
 *   - Allowed MIME types for upload
 *   - Transcoding settings
 *   - Thumbnail generation
 *   - Download restrictions
 */

const DEFAULT_MEDIA_POLICY = {
  // Playback
  autoplay_video: false,
  autoplay_audio: false,
  autoplay_gif: true,
  loop_gif: true,
  muted_autoplay: true,

  // Preview limits
  max_inline_image_mb: 20,
  max_inline_video_mb: 100,
  max_inline_audio_mb: 50,
  max_preview_width: 4096,
  max_preview_height: 4096,

  // Upload limits
  max_upload_size_mb: 250,
  max_uploads_per_message: 10,
  allowed_extensions: [
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp',
    'mp4', 'webm', 'mov', 'avi', 'mkv',
    'mp3', 'wav', 'ogg', 'aac', 'flac',
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'txt', 'md', 'csv', 'json', 'xml',
    'zip', 'tar', 'gz', '7z', 'rar',
  ],
  blocked_extensions: ['exe', 'bat', 'cmd', 'sh', 'ps1', 'msi', 'dll', 'sys'],

  // Thumbnails
  generate_thumbnails: true,
  thumbnail_width: 400,
  thumbnail_height: 400,
  thumbnail_quality: 80,

  // Security
  virus_scan_enabled: false,
  strip_exif: true,
  download_requires_auth: true,
  external_sharing_enabled: false,
  link_expiry_hours: 168, // 7 days for shared links
}

async function _GET() {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = 'media_policy'`
  )

  let policy = { ...DEFAULT_MEDIA_POLICY }
  if (rows[0]?.value) {
    try { policy = { ...policy, ...JSON.parse(rows[0].value) } } catch { /**/ }
  }

  return NextResponse.json({ policy })
}

async function _PUT(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as Partial<typeof DEFAULT_MEDIA_POLICY>

  if (body.max_upload_size_mb !== undefined && (body.max_upload_size_mb < 1 || body.max_upload_size_mb > 5000)) {
    return NextResponse.json({ error: 'max_upload_size_out_of_range (1-5000 MB)' }, { status: 400 })
  }

  const { rows: existing } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = 'media_policy'`
  )
  let current = { ...DEFAULT_MEDIA_POLICY }
  if (existing[0]?.value) {
    try { current = { ...current, ...JSON.parse(existing[0].value) } } catch { /**/ }
  }

  const updated = { ...current, ...body }
  const now = Date.now()

  await pool.query(`
    INSERT INTO aaelink.system_config (key, value, updated_at)
    VALUES ('media_policy', $1, $2)
    ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = $2
  `, [JSON.stringify(updated), now])

  return NextResponse.json({ policy: updated, updated_at: now })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/admin/media-policy', _GET)
export const PUT    = tracedRoute('PUT', '/api/admin/media-policy', _PUT)
