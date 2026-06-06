/**
 * file_thumbnail job — backfill image metadata + generate a thumbnail.
 *
 * file_attachments has width/height/duration_ms/thumbnail_key columns
 * (migration 033) that nothing populated. This worker-side handler:
 *   1. loads the attachment row (skips soft-deleted / missing),
 *   2. reads the stored bytes via the storage abstraction,
 *   3. sniffs dimensions with pure-JS extractImageMeta → UPDATE width/height,
 *   4. (if the media policy allows) generates a downscaled WebP thumbnail with
 *      sharp via a dynamic import, stores it as a derived object, and records
 *      thumbnail_key.
 *
 * sharp is a heavy native module vendored through Next's optionalDependencies
 * (ADR: dynamic import only — Hard Rule #7 forbids a new top-level dep). If the
 * import or the encode fails we log and skip the thumbnail; dimensions are still
 * saved so previews get aspect-ratio hints either way.
 *
 * Idempotent: dimensions UPDATE by id and the derived object overwrites at a
 * deterministic key, so re-running is safe.
 */
import type { Pool } from 'pg'
import { readFileBytes, storeDerivedBytes } from './storage'
import { extractImageMeta } from './imageMeta'

/** Thumbnail-relevant slice of the media_policy system_config blob. */
export interface ThumbnailPolicy {
  generate_thumbnails: boolean
  thumbnail_width: number
  thumbnail_height: number
  thumbnail_quality: number
}

/** Mirrors app/api/admin/media-policy/route.ts DEFAULT_MEDIA_POLICY (thumbnail keys). */
export const DEFAULT_THUMBNAIL_POLICY: ThumbnailPolicy = {
  generate_thumbnails: true,
  thumbnail_width: 400,
  thumbnail_height: 400,
  thumbnail_quality: 80,
}

/** Read the thumbnail-relevant media policy (defaults when unset/malformed). */
export async function getThumbnailPolicy(pool: Pool): Promise<ThumbnailPolicy> {
  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = 'media_policy'`
  )
  const out = { ...DEFAULT_THUMBNAIL_POLICY }
  if (rows[0]?.value) {
    try {
      const p = JSON.parse(rows[0].value) as Partial<ThumbnailPolicy>
      if (typeof p.generate_thumbnails === 'boolean') out.generate_thumbnails = p.generate_thumbnails
      if (Number.isFinite(p.thumbnail_width)) out.thumbnail_width = Number(p.thumbnail_width)
      if (Number.isFinite(p.thumbnail_height)) out.thumbnail_height = Number(p.thumbnail_height)
      if (Number.isFinite(p.thumbnail_quality)) out.thumbnail_quality = Number(p.thumbnail_quality)
    } catch {
      /* malformed → defaults */
    }
  }
  return out
}

export interface FileThumbnailResult {
  /** Whether width/height were extracted and persisted. */
  dimensionsSaved: boolean
  width: number | null
  height: number | null
  /** Whether a thumbnail object was generated + recorded. */
  thumbnailSaved: boolean
}

const NOOP: FileThumbnailResult = {
  dimensionsSaved: false,
  width: null,
  height: null,
  thumbnailSaved: false,
}

/**
 * Generate a WebP thumbnail with sharp (dynamic import). Returns null when sharp
 * is unavailable or processing fails — the caller treats that as skip-thumbnail,
 * not job failure.
 */
/**
 * Hard ceiling on the input pixel count sharp will decode. A small-on-disk image
 * can declare an enormous canvas (decompression bomb) and force a full raster
 * allocation before resize. We pin an explicit cap so policy — not sharp's
 * library default (~268M px) — governs the bound; oversized inputs are rejected
 * by sharp and land in the try/catch as a graceful skip-thumbnail.
 */
const MAX_THUMBNAIL_INPUT_PIXELS = 50_000_000

async function tryGenerateThumbnail(
  bytes: Buffer,
  policy: ThumbnailPolicy
): Promise<Buffer | null> {
  try {
    // sharp is optional (Next optionalDependencies); never a static import.
    const mod = (await import('sharp')) as unknown as {
      default: (
        input: Buffer,
        opts?: { limitInputPixels?: number; failOn?: 'error' }
      ) => {
        rotate: () => {
          resize: (
            w: number,
            h: number,
            opts: { fit: 'inside'; withoutEnlargement: boolean }
          ) => {
            webp: (opts: { quality: number }) => { toBuffer: () => Promise<Buffer> }
          }
        }
      }
    }
    const sharp = mod.default || (mod as unknown as typeof mod.default)
    // limitInputPixels caps the decode size (decompression-bomb guard);
    // failOn:'error' makes truncated/corrupt inputs throw → graceful skip.
    const out = await sharp(bytes, { limitInputPixels: MAX_THUMBNAIL_INPUT_PIXELS, failOn: 'error' })
      // .rotate() with no args auto-applies EXIF orientation, then strips it —
      // honoring the policy's strip_exif intent for the derived thumbnail.
      .rotate()
      .resize(policy.thumbnail_width, policy.thumbnail_height, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: policy.thumbnail_quality })
      .toBuffer()
    return out && out.length > 0 ? out : null
  } catch {
    return null
  }
}

/**
 * Run the thumbnail/metadata backfill for one file.
 *
 * @returns a result describing what was persisted. Throws only on a missing
 * file_id argument; a missing/deleted row, unreadable bytes, or non-image
 * content all resolve to a no-op result (the job is "done", nothing to do).
 */
export async function runFileThumbnail(
  pool: Pool,
  payload: { file_id?: string }
): Promise<FileThumbnailResult> {
  const fileId = String(payload?.file_id || '').trim()
  if (!fileId) throw new Error('file_thumbnail: file_id required')

  const { rows } = await pool.query<{
    storage_key: string
    storage_backend: string | null
    content_type: string
    deleted_at: string
  }>(
    `SELECT storage_key, storage_backend, content_type, deleted_at::text AS deleted_at
       FROM aaelink.file_attachments WHERE id = $1`,
    [fileId]
  )
  const file = rows[0]
  // Missing or soft-deleted → nothing to do (not an error; row may be gone).
  if (!file || Number(file.deleted_at) !== 0) return NOOP

  const bytes = await readFileBytes(file.storage_key, file.storage_backend)
  if (!bytes) return NOOP

  // Sniff the container from magic bytes — content_type is user-supplied and
  // advisory only. Non-image / unsupported → no dimensions, no thumbnail.
  const meta = extractImageMeta(bytes)
  if (!meta) return NOOP

  // Persist display dimensions (idempotent UPDATE by id).
  await pool.query(
    `UPDATE aaelink.file_attachments SET width = $1, height = $2 WHERE id = $3`,
    [meta.width, meta.height, fileId]
  )

  const result: FileThumbnailResult = {
    dimensionsSaved: true,
    width: meta.width,
    height: meta.height,
    thumbnailSaved: false,
  }

  const policy = await getThumbnailPolicy(pool)
  if (!policy.generate_thumbnails) return result

  const thumb = await tryGenerateThumbnail(bytes, policy)
  if (!thumb) return result // sharp unavailable / failed → dims still saved.

  // Store the thumbnail on the SAME backend the source row records, so serve
  // (previewThumbnail) and retention (retentionJob) — which both resolve the
  // thumbnail via the row's storage_backend — find it where they expect. When
  // the row says 's3' but no S3 client is available, storeDerivedBytes returns
  // null; treat that as skip-thumbnail (dims still saved), not job failure.
  const stored = await storeDerivedBytes({
    fileId,
    body: thumb,
    contentType: 'image/webp',
    backend: file.storage_backend,
  })
  if (!stored) return result
  await pool.query(
    `UPDATE aaelink.file_attachments SET thumbnail_key = $1 WHERE id = $2`,
    [stored.storageKey, fileId]
  )
  result.thumbnailSaved = true
  return result
}
