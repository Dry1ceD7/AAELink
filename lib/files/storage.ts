/**
 * File storage backend abstraction for the chat file path.
 *
 * Two backends, selected automatically:
 *   - 's3'    when S3_ENDPOINT is configured (getS3Client() non-null)
 *   - 'local' otherwise — disk under AAELINK_UPLOAD_DIR (dev + tests stay green
 *             with no S3 env, which is the contract the test harness relies on)
 *
 * The chosen backend is recorded on the file row (file_attachments.storage_backend,
 * migration 034) so reads and deletes resolve bytes from the same place they were
 * written, even if S3 is later configured/unconfigured.
 *
 * S3 object keys are namespaced 'chat/<file-id>/<filename>'. Local keys stay the
 * flat '<id><ext>' form Stage A wrote, so existing rows keep resolving.
 */
import fs from 'fs'
import path from 'path'
import {
  getS3Client,
  getBucket,
  putObjectBytes,
  getObjectBytes,
  deleteObject,
} from '@/lib/infra/s3'

export type StorageBackend = 's3' | 'local'

export const UPLOAD_DIR =
  process.env.AAELINK_UPLOAD_DIR || path.join(process.cwd(), '.uploads')

/** Sanitize a filename for use inside an object key (no path separators). */
function safeName(filename: string): string {
  return filename.replace(/[/\\]+/g, '_').replace(/\0/g, '')
}

/**
 * Persist the bytes for a chat upload. Returns the backend used and the
 * storage_key to record on the row. When S3 is configured the key is
 * 'chat/<id>/<filename>'; otherwise the caller-provided local key is used.
 */
export async function storeFileBytes(params: {
  fileId: string
  filename: string
  contentType: string
  body: Buffer
  /** Flat local key (e.g. '<id><ext>') used when the local backend is selected. */
  localKey: string
}): Promise<{ backend: StorageBackend; storageKey: string }> {
  const s3 = getS3Client()
  if (s3) {
    const storageKey = `chat/${params.fileId}/${safeName(params.filename)}`
    await putObjectBytes({
      s3,
      bucket: getBucket(),
      key: storageKey,
      body: params.body,
      contentType: params.contentType,
    })
    return { backend: 's3', storageKey }
  }

  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  fs.writeFileSync(path.join(UPLOAD_DIR, params.localKey), params.body)
  return { backend: 'local', storageKey: params.localKey }
}

/**
 * Compute the storage key for a file's derived thumbnail, per backend.
 *   - s3:    'thumb/<file-id>.webp'   (namespaced alongside 'chat/<id>/…')
 *   - local: '<file-id>.thumb.webp'   (flat, matching the local '<id><ext>' form)
 * Pure — no I/O — so callers can persist the key without re-deriving it.
 */
export function derivedThumbnailKey(fileId: string, backend: StorageBackend): string {
  return backend === 's3' ? `thumb/${fileId}.webp` : `${fileId}.thumb.webp`
}

/**
 * Persist derived bytes (e.g. a generated thumbnail) for an existing file.
 *
 * The derived object's backend is taken from the SOURCE row's recorded backend
 * (`backend`), NOT from current getS3Client() presence. This is deliberate:
 * serve (previewThumbnail) and retention (retentionJob) resolve/delete the
 * thumbnail using the file row's storage_backend, so the thumbnail MUST live on
 * the same backend the row records. Selecting from getS3Client() instead would
 * break on mixed-backend deployments — e.g. a file uploaded while local, then S3
 * later configured: the source bytes still read from disk, but the thumbnail
 * would be written to S3 while serve/retention look on disk (404 + orphan).
 * Branching on the recorded backend (mirroring readFileBytes) keeps the
 * consumers' "thumbnail backend == row backend" assumption true.
 *
 * `backend === 's3'` requires an S3 client; when one is unavailable the write is
 * skipped and `null` is returned (the caller treats that as skip-thumbnail, not
 * job failure). Any other value (local / unknown / legacy) writes to disk.
 *
 * Overwrites any existing object at the key, making re-runs of the thumbnail job
 * idempotent. Returns the backend actually used and the derived storage key, or
 * null when the recorded backend is 's3' but no S3 client is available.
 */
export async function storeDerivedBytes(params: {
  fileId: string
  body: Buffer
  contentType: string
  /** Source row's recorded backend — the derived object lands here too. */
  backend: StorageBackend | string | null | undefined
  /** Defaults to 'image/webp' derived thumbnails. */
}): Promise<{ backend: StorageBackend; storageKey: string } | null> {
  if (params.backend === 's3') {
    const s3 = getS3Client()
    if (!s3) return null
    const storageKey = derivedThumbnailKey(params.fileId, 's3')
    await putObjectBytes({
      s3,
      bucket: getBucket(),
      key: storageKey,
      body: params.body,
      contentType: params.contentType,
    })
    return { backend: 's3', storageKey }
  }

  // local (and unknown/legacy → disk), mirroring readFileBytes' fallback.
  const storageKey = derivedThumbnailKey(params.fileId, 'local')
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  fs.writeFileSync(path.join(UPLOAD_DIR, storageKey), params.body)
  return { backend: 'local', storageKey }
}

/**
 * Read the bytes for a stored file. Resolves via the recorded backend; falls
 * back to disk when the backend is unknown/legacy so pre-Stage-B rows keep
 * downloading. Returns null when the object is missing.
 */
export async function readFileBytes(
  storageKey: string,
  backend: StorageBackend | string | null | undefined
): Promise<Buffer | null> {
  if (backend === 's3') {
    const s3 = getS3Client()
    if (!s3) return null
    try {
      return await getObjectBytes(s3, getBucket(), storageKey)
    } catch {
      return null
    }
  }

  // local (and unknown/legacy → disk)
  const filePath = path.join(UPLOAD_DIR, storageKey)
  try {
    return fs.readFileSync(filePath)
  } catch {
    return null
  }
}

/**
 * Best-effort removal of the underlying object. Never throws — failures are
 * swallowed so a soft-delete response is never blocked by storage I/O. Returns
 * true when the object was removed (or already absent).
 */
export async function removeFileObject(
  storageKey: string,
  backend: StorageBackend | string | null | undefined
): Promise<boolean> {
  try {
    if (backend === 's3') {
      const s3 = getS3Client()
      if (!s3) return false
      await deleteObject(s3, getBucket(), storageKey)
      return true
    }
    const filePath = path.join(UPLOAD_DIR, storageKey)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    return true
  } catch {
    return false
  }
}
