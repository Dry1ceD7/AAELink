/**
 * D12 Files — virus-scan access gate.
 *
 * Uploaded files are scanned (file_scans rows record a result: pending / clean /
 * infected). This is the enforcement layer: before a file is served — direct
 * download or via a public link — its latest scan verdict is checked against the
 * org scan policy. Infected files are always blocked; whether not-yet-scanned
 * files are blocked is configurable (strict mode).
 */
import type { Pool } from 'pg'
import { randomUUID } from 'crypto'

export type ScanVerdict = 'clean' | 'infected' | 'pending' | 'unscanned'

/** Latest scan verdict for a file. 'unscanned' when no scan row exists. */
export async function getScanVerdict(pool: Pool, fileId: string): Promise<ScanVerdict> {
  const { rows } = await pool.query<{ result: string }>(
    `SELECT result FROM aaelink.file_scans
      WHERE file_id = $1
      ORDER BY scanned_at DESC, created_at DESC
      LIMIT 1`,
    [fileId]
  )
  const r = rows[0]?.result
  if (r === 'clean' || r === 'infected' || r === 'pending') return r
  return r ? 'pending' : 'unscanned'
}

/** Record a scan result for a file. */
export async function recordScanResult(
  pool: Pool,
  params: {
    fileId: string
    result: 'pending' | 'clean' | 'infected'
    threatName?: string
    engine?: string
    filename?: string
    fileSize?: number
    mimeType?: string
    uploadedBy?: string
  },
  now = Date.now()
): Promise<void> {
  await pool.query(
    `INSERT INTO aaelink.file_scans
       (id, file_id, filename, file_size, mime_type, result, scan_engine, threat_name, uploaded_by, created_at, scanned_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      randomUUID(), params.fileId, params.filename ?? '', params.fileSize ?? 0,
      params.mimeType ?? '', params.result, params.engine ?? 'clamav',
      params.threatName ?? '', params.uploadedBy ?? null, now,
      params.result === 'pending' ? 0 : now,
    ]
  )
}

export interface ScanPolicy {
  /** Always true — infected files are never served. */
  block_infected: boolean
  /** Strict mode: also block files not yet scanned clean (pending/unscanned). */
  block_unscanned: boolean
}

export const DEFAULT_SCAN_POLICY: ScanPolicy = { block_infected: true, block_unscanned: false }

const POLICY_KEY = 'file_scan_policy'

export async function getScanPolicy(pool: Pool): Promise<ScanPolicy> {
  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = $1`, [POLICY_KEY]
  )
  if (!rows[0]?.value) return { ...DEFAULT_SCAN_POLICY }
  try {
    // block_infected is not configurable away — always enforced.
    return { ...DEFAULT_SCAN_POLICY, ...(JSON.parse(rows[0].value) as Partial<ScanPolicy>), block_infected: true }
  } catch {
    return { ...DEFAULT_SCAN_POLICY }
  }
}

export async function setScanPolicy(pool: Pool, patch: Partial<ScanPolicy>): Promise<ScanPolicy> {
  const current = await getScanPolicy(pool)
  const updated: ScanPolicy = { ...current, ...patch, block_infected: true }
  await pool.query(
    `INSERT INTO aaelink.system_config (key, value, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3`,
    [POLICY_KEY, JSON.stringify(updated), Date.now()]
  )
  return updated
}

/** Pure decision: may a file with this verdict be served under this policy? */
export function verdictAllowsAccess(verdict: ScanVerdict, policy: ScanPolicy): boolean {
  if (verdict === 'infected') return false
  if (verdict === 'clean') return true
  // pending / unscanned
  return !policy.block_unscanned
}

/** Whether a file may be served right now (latest verdict vs current policy). */
export async function isFileAccessAllowed(pool: Pool, fileId: string): Promise<boolean> {
  const [verdict, policy] = await Promise.all([getScanVerdict(pool, fileId), getScanPolicy(pool)])
  return verdictAllowsAccess(verdict, policy)
}
