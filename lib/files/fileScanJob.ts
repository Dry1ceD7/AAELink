/**
 * file_scan job orchestration — real ClamAV virus scan.
 *
 * Reads the attachment bytes via the storage abstraction (S3 when the row was
 * stored on S3, local disk otherwise — same source the D12 download gate serves
 * from), streams them to clamd via INSTREAM, and writes the verdict to the
 * file_scans row the D12 gate reads.
 *
 *   clamd clean    → result 'clean'
 *   clamd infected → result 'infected' (+ threat_name)
 *   clamd down     → result 'pending' (NOT 'clean') so strict policy can block
 */
import type { Pool } from 'pg'
import { scanBuffer } from './clamav'
import { readFileBytes } from './storage'
import { writeAuditLog } from '@/lib/enterprise/auditLog'

export type FileScanVerdict = 'clean' | 'infected' | 'pending'

export interface FileScanResult {
  result: FileScanVerdict
  threatName: string
}

/** Persist the verdict onto the file's scan row(s). */
async function recordVerdict(
  pool: Pool, fileId: string, scanId: string | undefined,
  result: FileScanVerdict, threatName: string
): Promise<void> {
  const now = Date.now()
  const scannedAt = result === 'pending' ? 0 : now
  if (scanId) {
    await pool.query(
      `UPDATE aaelink.file_scans
          SET result = $2, threat_name = $3, scanned_at = $4
        WHERE id = $1`,
      [scanId, result, threatName, scannedAt]
    )
  } else {
    await pool.query(
      `UPDATE aaelink.file_scans
          SET result = $2, threat_name = $3, scanned_at = $4
        WHERE file_id = $1`,
      [fileId, result, threatName, scannedAt]
    )
  }
}

export async function runFileScan(
  pool: Pool, payload: { file_id?: string; scan_id?: string }
): Promise<FileScanResult> {
  const fileId = String(payload.file_id || '').trim()
  const scanId = payload.scan_id ? String(payload.scan_id) : undefined
  if (!fileId) throw new Error('file_scan: file_id required')

  // Resolve the stored bytes via the recorded backend (S3 or local disk) so an
  // S3-backed upload is scanned from S3, not a non-existent local path.
  const { rows } = await pool.query<{ storage_key: string; storage_backend: string | null }>(
    `SELECT storage_key, storage_backend FROM aaelink.file_attachments WHERE id = $1`, [fileId]
  )
  const storageKey = rows[0]?.storage_key
  if (!storageKey) {
    await recordVerdict(pool, fileId, scanId, 'pending', '')
    throw new Error(`file_scan: attachment ${fileId} not found`)
  }

  const data = await readFileBytes(storageKey, rows[0]?.storage_backend)
  if (!data) {
    await recordVerdict(pool, fileId, scanId, 'pending', '')
    throw new Error(`file_scan: bytes missing for ${fileId}`)
  }

  const scan = await scanBuffer(data)
  const result: FileScanVerdict = scan.verdict === 'unknown' ? 'pending' : scan.verdict
  await recordVerdict(pool, fileId, scanId, result, scan.threatName)

  if (result !== 'pending') {
    writeAuditLog({
      pool,
      action: 'file.scan.complete',
      resourceKind: 'file',
      resourceId: fileId,
      metadata: { result, threat_name: scan.threatName, engine: 'clamav' },
    })
  }

  return { result, threatName: scan.threatName }
}
