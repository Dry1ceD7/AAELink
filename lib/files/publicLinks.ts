/**
 * D12 Files — public share links + external-sharing control.
 *
 * A file's uploader can mint a tokenized public link so the file can be fetched
 * without a session, and revoke it. Whether public links are permitted at all is
 * an org-level control (file_sharing_policy in system_config), letting an admin
 * disable external file sharing wholesale. Default: enabled.
 */
import type { Pool } from 'pg'
import { randomUUID } from 'crypto'

export interface FileSharingPolicy {
  public_links_enabled: boolean
}

export const DEFAULT_FILE_SHARING_POLICY: FileSharingPolicy = { public_links_enabled: true }

const POLICY_KEY = 'file_sharing_policy'

/** Current file-sharing policy (defaults merged over stored overrides). */
export async function getFileSharingPolicy(pool: Pool): Promise<FileSharingPolicy> {
  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = $1`, [POLICY_KEY]
  )
  if (!rows[0]?.value) return { ...DEFAULT_FILE_SHARING_POLICY }
  try {
    return { ...DEFAULT_FILE_SHARING_POLICY, ...(JSON.parse(rows[0].value) as Partial<FileSharingPolicy>) }
  } catch {
    return { ...DEFAULT_FILE_SHARING_POLICY }
  }
}

/** Update the file-sharing policy. */
export async function setFileSharingPolicy(pool: Pool, patch: Partial<FileSharingPolicy>): Promise<FileSharingPolicy> {
  const current = await getFileSharingPolicy(pool)
  const updated: FileSharingPolicy = { ...current, ...patch }
  await pool.query(
    `INSERT INTO aaelink.system_config (key, value, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3`,
    [POLICY_KEY, JSON.stringify(updated), Date.now()]
  )
  return updated
}

export type CreateLinkResult =
  | { ok: true; token: string; fileId: string }
  | { ok: false; code: 'sharing_disabled' | 'not_found' | 'forbidden' }

/**
 * Mint (or reuse) a public link for a file. The file's uploader only, and only
 * while public links are permitted org-wide. Reusing keeps the existing active
 * token so a previously shared URL stays valid.
 */
export async function createPublicLink(pool: Pool, uid: string, fileId: string): Promise<CreateLinkResult> {
  if (!(await getFileSharingPolicy(pool)).public_links_enabled) return { ok: false, code: 'sharing_disabled' }

  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM aaelink.file_attachments WHERE id = $1`, [fileId]
  )
  const file = rows[0]
  if (!file) return { ok: false, code: 'not_found' }
  if (file.user_id !== uid) return { ok: false, code: 'forbidden' }

  const { rows: active } = await pool.query<{ token: string }>(
    `SELECT token FROM aaelink.file_public_links WHERE file_id = $1 AND enabled = true AND revoked_at = 0 LIMIT 1`,
    [fileId]
  )
  if (active[0]) return { ok: true, token: active[0].token, fileId }

  const token = `flink_${randomUUID().replace(/-/g, '')}`
  await pool.query(
    `INSERT INTO aaelink.file_public_links (id, file_id, token, enabled, created_by, created_at)
     VALUES ($1, $2, $3, true, $4, $5)`,
    [randomUUID(), fileId, token, uid, Date.now()]
  )
  return { ok: true, token, fileId }
}

export interface PublicFile {
  file_id: string
  filename: string
  content_type: string
  size: number
  storage_key: string
}

/**
 * Resolve a public link token to its file, or null when the token is unknown,
 * disabled, revoked, or external sharing is turned off org-wide.
 */
export async function resolvePublicLink(pool: Pool, token: string): Promise<PublicFile | null> {
  if (!(await getFileSharingPolicy(pool)).public_links_enabled) return null
  const { rows } = await pool.query<{
    file_id: string; filename: string; content_type: string; size: string; storage_key: string
  }>(
    `SELECT f.id AS file_id, f.filename, f.content_type, f.size::text AS size, f.storage_key
       FROM aaelink.file_public_links l
       JOIN aaelink.file_attachments f ON f.id = l.file_id
      WHERE l.token = $1 AND l.enabled = true AND l.revoked_at = 0`,
    [String(token || '').trim()]
  )
  const r = rows[0]
  if (!r) return null
  return { file_id: r.file_id, filename: r.filename, content_type: r.content_type, size: Number(r.size), storage_key: r.storage_key }
}

export type RevokeLinkResult =
  | { ok: true; fileId: string }
  | { ok: false; code: 'not_found' | 'forbidden' }

/** Revoke all public links for a file. Uploader only. */
export async function revokePublicLinks(pool: Pool, uid: string, fileId: string): Promise<RevokeLinkResult> {
  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM aaelink.file_attachments WHERE id = $1`, [fileId]
  )
  const file = rows[0]
  if (!file) return { ok: false, code: 'not_found' }
  if (file.user_id !== uid) return { ok: false, code: 'forbidden' }

  await pool.query(
    `UPDATE aaelink.file_public_links SET enabled = false, revoked_at = $2
      WHERE file_id = $1 AND revoked_at = 0`,
    [fileId, Date.now()]
  )
  return { ok: true, fileId }
}
