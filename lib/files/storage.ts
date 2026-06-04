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
