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

/**
 * Single source of truth for the org-wide file scan policy.
 *
 * This is the ENFORCED shape. Both the access gate (download / public-link
 * serving) and the upload route + post-upload pipeline read it. The admin route
 * POST /api/files/scan?update_policy mutates THIS shape and nothing else, so an
 * admin can never clobber the security flags or write a divergent "decorative"
 * shape to the same system_config key.
 *
 * Field meanings / enforcement points:
 *   - block_infected — always true, non-configurable. Infected files are never
 *     served. Pinned in getScanPolicy/setScanPolicy regardless of stored JSON.
 *   - block_unscanned — strict mode: also block files not yet scanned clean
 *     (pending/unscanned) at serve time. Enforced by verdictAllowsAccess.
 *   - scan_on_upload — gate the scan-job enqueue in lib/files/fileJobs.ts. When
 *     false, uploads still index but no ClamAV verdict is requested (the gate
 *     then treats them as unscanned, so block_unscanned still applies on serve).
 *   - max_file_size_mb — hard upload cap in MB; 0 disables the policy cap and
 *     the route falls back to its built-in default. Enforced at upload BEFORE
 *     storing bytes (413 file_too_large).
 *   - blocked_extensions — lowercase extensions WITH the leading dot
 *     (e.g. '.exe'). Enforced at upload (415 extension_blocked).
 *   - auto_delete_infected_after_days — retention horizon for infected files;
 *     0 disables. STORED-NOT-YET-ENFORCED: no clean consumer exists today, so
 *     the field is persisted for a future retention/cleanup pass rather than an
 *     invented job. See design notes.
 */
export interface ScanPolicy {
  /** Always true — infected files are never served. */
  block_infected: boolean
  /** Strict mode: also block files not yet scanned clean (pending/unscanned). */
  block_unscanned: boolean
  /** Request a ClamAV scan on upload (gates the scan-job enqueue). */
  scan_on_upload: boolean
  /** Hard upload size cap in MB; 0 = no policy cap (route default applies). */
  max_file_size_mb: number
  /** Lowercase extensions with a leading dot, e.g. ['.exe', '.bat']. */
  blocked_extensions: string[]
  /** Retention horizon for infected files in days; 0 = off. Stored, not yet enforced. */
  auto_delete_infected_after_days: number
}

export const DEFAULT_SCAN_POLICY: ScanPolicy = {
  block_infected: true,
  block_unscanned: false,
  scan_on_upload: true,
  max_file_size_mb: 0,
  blocked_extensions: [],
  auto_delete_infected_after_days: 0,
}

const POLICY_KEY = 'file_scan_policy'

/** Normalize blocked_extensions: lowercase, dot-prefixed, de-duped, no blanks. */
function normalizeBlockedExtensions(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  for (const raw of input) {
    if (typeof raw !== 'string') continue
    let ext = raw.trim().toLowerCase()
    if (!ext) continue
    if (!ext.startsWith('.')) ext = `.${ext}`
    if (ext === '.') continue
    if (!out.includes(ext)) out.push(ext)
  }
  return out
}

/**
 * Coerce arbitrary stored / patched JSON into a valid ScanPolicy on top of a
 * base. Tolerates EITHER legacy shape stored at POLICY_KEY:
 *   - the original gate shape { block_infected, block_unscanned }
 *   - the old route shape { enabled, scan_on_upload, quarantine_infected,
 *     max_file_size_mb, blocked_extensions, scan_engine,
 *     auto_delete_infected_after_days }
 * Decorative legacy keys (enabled, quarantine_infected, scan_engine) are ignored.
 * block_infected can never be unset — it is pinned true at the end.
 */
function coerceScanPolicy(base: ScanPolicy, raw: Record<string, unknown>): ScanPolicy {
  const merged: ScanPolicy = { ...base }

  if (typeof raw.block_unscanned === 'boolean') merged.block_unscanned = raw.block_unscanned
  if (typeof raw.scan_on_upload === 'boolean') merged.scan_on_upload = raw.scan_on_upload

  if (typeof raw.max_file_size_mb === 'number' && Number.isFinite(raw.max_file_size_mb)) {
    merged.max_file_size_mb = Math.max(0, Math.floor(raw.max_file_size_mb))
  }
  if (typeof raw.auto_delete_infected_after_days === 'number' && Number.isFinite(raw.auto_delete_infected_after_days)) {
    merged.auto_delete_infected_after_days = Math.max(0, Math.floor(raw.auto_delete_infected_after_days))
  }
  if (raw.blocked_extensions !== undefined) {
    merged.blocked_extensions = normalizeBlockedExtensions(raw.blocked_extensions)
  }

  // block_infected is not configurable away — always enforced. Never let stored
  // JSON (legacy or current) unset it.
  merged.block_infected = true
  return merged
}

export async function getScanPolicy(pool: Pool): Promise<ScanPolicy> {
  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = $1`, [POLICY_KEY]
  )
  if (!rows[0]?.value) return { ...DEFAULT_SCAN_POLICY }
  try {
    const parsed = JSON.parse(rows[0].value) as Record<string, unknown>
    return coerceScanPolicy(DEFAULT_SCAN_POLICY, parsed)
  } catch {
    return { ...DEFAULT_SCAN_POLICY }
  }
}

export async function setScanPolicy(pool: Pool, patch: Partial<ScanPolicy>): Promise<ScanPolicy> {
  const current = await getScanPolicy(pool)
  // Run the patch through the same coercion so callers passing legacy keys or
  // un-normalized extensions still land a valid, pinned policy.
  const updated = coerceScanPolicy(current, patch as Record<string, unknown>)
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
