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
import { recordScanResult, getScanPolicy } from './scanGate'

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

  const createdBy = input.uploadedBy ?? null

  // Scan-enqueue block — gated by the org scan policy. When scan_on_upload is
  // false no ClamAV verdict is requested (no pending row, no file_scan job); the
  // D12 gate then treats the upload as unscanned, so block_unscanned still
  // governs serve-time access. Default policy keeps scanning ON.
  const policy = await getScanPolicy(pool)
  let realScanId = ''
  if (policy.scan_on_upload) {
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
    realScanId = rows[0]?.id || randomUUID()

    // file_scan job (priority 8 — match the manual scan route).
    await pool.query(
      `INSERT INTO aaelink.jobs
         (id, type, status, priority, payload, run_after, max_retries, attempts, created_by, created_at)
       VALUES ($1, 'file_scan', 'pending', 8, $2, $3, 3, 0, $4, $3)`,
      [randomUUID(), JSON.stringify({ scan_id: realScanId, file_id: fileId }), now, createdBy]
    )
  }

  // file_index job (priority 6 — match the manual index_rebuild enqueue).
  await pool.query(
    `INSERT INTO aaelink.jobs
       (id, type, status, priority, payload, run_after, max_retries, attempts, created_by, created_at)
     VALUES ($1, 'file_index', 'pending', 6, $2, $3, 3, 0, $4, $3)`,
    [randomUUID(), JSON.stringify({ file_id: fileId }), now, createdBy]
  )

  // file_thumbnail job (priority 5) — only for images. This is a cheap
  // pre-filter on the declared mime type; the worker re-sniffs the bytes with
  // extractImageMeta and no-ops on anything that is not actually an image.
  if (String(input.mimeType || '').toLowerCase().startsWith('image/')) {
    await pool.query(
      `INSERT INTO aaelink.jobs
         (id, type, status, priority, payload, run_after, max_retries, attempts, created_by, created_at)
       VALUES ($1, 'file_thumbnail', 'pending', 5, $2, $3, 3, 0, $4, $3)`,
      [randomUUID(), JSON.stringify({ file_id: fileId }), now, createdBy]
    )
  }

  return { scanId: realScanId }
}
