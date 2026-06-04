/**
 * Post-upload pipeline enqueue helpers.
 *
 * On a successful chat upload we want two things to happen asynchronously via
 * the existing aaelink.jobs queue (lib/infra/worker.ts handlers):
 *   1. file_scan  — ClamAV verdict (D12 gate reads file_scans). Mirrors the
 *      manual POST /api/files/scan flow: a pending file_scans row + a job.
 *   2. file_index — extract searchable content into aaelink.file_index so
 *      GET /api/search/files can find the upload.
 *
 * Enqueue follows the same direct-INSERT pattern used elsewhere (clips,
 * files/scan, search/files). Best-effort: a queue failure must never fail the
 * upload response, so callers wrap this in a try/catch (fire-and-forget).
 */
import type { Pool } from 'pg'
import { randomUUID } from 'crypto'
import { recordScanResult } from './scanGate'

export interface EnqueueUploadJobsInput {
  fileId: string
  filename?: string
  fileSize?: number
  mimeType?: string
  uploadedBy?: string
}

/**
 * Enqueue scan + index jobs for a freshly-uploaded file. Inserts a pending
 * file_scans row (so the D12 gate has a verdict to read and the scan worker has
 * a scan_id), then a file_scan job and a file_index job. Idempotent enough for
 * retries at the call site is not guaranteed — call once per upload.
 */
export async function enqueueUploadJobs(
  pool: Pool,
  input: EnqueueUploadJobsInput
): Promise<{ scanId: string }> {
  const fileId = String(input.fileId || '').trim()
  if (!fileId) throw new Error('enqueueUploadJobs: file_id required')
  const now = Date.now()

  // Pending scan row (mirrors POST /api/files/scan). file_scans.uploaded_by is
  // a plain TEXT column (no FK), so a null uploader is fine.
  await recordScanResult(
    pool,
    {
      fileId,
      result: 'pending',
      filename: input.filename ?? '',
      fileSize: input.fileSize ?? 0,
      mimeType: input.mimeType ?? '',
      uploadedBy: input.uploadedBy,
    },
    now
  )
  // recordScanResult generates its own id; re-read it so the job carries the
  // matching scan_id the worker updates. (recordScanResult does not return it.)
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM aaelink.file_scans WHERE file_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [fileId]
  )
  const realScanId = rows[0]?.id || randomUUID()

  const createdBy = input.uploadedBy ?? null

  // file_scan job (priority 8 — match the manual scan route).
  await pool.query(
    `INSERT INTO aaelink.jobs
       (id, type, status, priority, payload, run_after, max_retries, attempts, created_by, created_at)
     VALUES ($1, 'file_scan', 'pending', 8, $2, $3, 3, 0, $4, $3)`,
    [randomUUID(), JSON.stringify({ scan_id: realScanId, file_id: fileId }), now, createdBy]
  )

  // file_index job (priority 6 — match the manual index_rebuild enqueue).
  await pool.query(
    `INSERT INTO aaelink.jobs
       (id, type, status, priority, payload, run_after, max_retries, attempts, created_by, created_at)
     VALUES ($1, 'file_index', 'pending', 6, $2, $3, 3, 0, $4, $3)`,
    [randomUUID(), JSON.stringify({ file_id: fileId }), now, createdBy]
  )

  return { scanId: realScanId }
}
