/**
 * file_index job — extract searchable content from an uploaded file and
 * populate aaelink.file_index (content_preview + search_vector) so
 * GET /api/search/files can find it. This is the worker side that backfills
 * the previously-empty file_index table for real uploads.
 *
 * Scope (Stage B): plain-text-ish content types are read directly and indexed.
 * Binary/office/PDF extraction (Stirling-PDF / tika) is deferred — those rows
 * are recorded with an empty preview so the file still appears by filename via
 * other surfaces, and re-indexing later just UPSERTs.
 */
import type { Pool } from 'pg'
import { randomUUID } from 'crypto'
import { readFileBytes } from './storage'

/** Content types we can extract searchable text from inline. */
const TEXT_LIKE = [
  'text/',
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-yaml',
  'application/yaml',
]

export function isTextIndexable(contentType: string): boolean {
  const ct = String(contentType || '').toLowerCase()
  return TEXT_LIKE.some((p) => ct.startsWith(p) || ct === p)
}

/** Max bytes pulled into memory for extraction, and max preview length stored. */
const MAX_EXTRACT_BYTES = 1024 * 1024 // 1 MB
const PREVIEW_LIMIT = 5000

export interface FileIndexResult {
  indexed: boolean
  contentLength: number
}

/**
 * Build (or refresh) the file_index row for a file. Idempotent: re-running
 * UPSERTs by file_id. Returns indexed=false (with an empty row written) when the
 * type is not text-extractable or the bytes are unavailable.
 */
export async function runFileIndex(
  pool: Pool,
  payload: { file_id?: string }
): Promise<FileIndexResult> {
  const fileId = String(payload.file_id || '').trim()
  if (!fileId) throw new Error('file_index: file_id required')

  const { rows } = await pool.query<{
    storage_key: string
    storage_backend: string | null
    filename: string
    content_type: string
    channel_id: string | null
    user_id: string
  }>(
    `SELECT storage_key, storage_backend, filename, content_type, channel_id, user_id
       FROM aaelink.file_attachments WHERE id = $1`,
    [fileId]
  )
  const file = rows[0]
  if (!file) throw new Error(`file_index: attachment ${fileId} not found`)

  const fileType = String(file.content_type || '').split('/')[1] || ''

  let preview = ''
  let contentLength = 0
  if (isTextIndexable(file.content_type)) {
    const bytes = await readFileBytes(file.storage_key, file.storage_backend)
    if (bytes) {
      const text = bytes.subarray(0, MAX_EXTRACT_BYTES).toString('utf8')
      contentLength = text.length
      preview = text.slice(0, PREVIEW_LIMIT)
    }
  }

  await pool.query(
    `INSERT INTO aaelink.file_index
       (id, file_id, filename, file_type, channel_id, content_preview,
        content_length, search_vector, uploaded_by, indexed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, to_tsvector('english', $6), $8, $9)
     ON CONFLICT (file_id) DO UPDATE SET
       filename = $3, file_type = $4, channel_id = $5,
       content_preview = $6, content_length = $7,
       search_vector = to_tsvector('english', $6), indexed_at = $9`,
    [
      randomUUID(),
      fileId,
      file.filename,
      fileType,
      file.channel_id,
      preview,
      contentLength,
      file.user_id,
      Date.now(),
    ]
  )

  return { indexed: preview.length > 0, contentLength }
}
