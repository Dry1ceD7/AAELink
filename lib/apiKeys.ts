/**
 * AAELink API Key Management System
 *
 * Provides secure API key generation, validation, and lifecycle management
 * for programmatic access to the AAELink platform. Keys support:
 *
 *   - Scoped permissions (read, write, admin)
 *   - Expiration dates
 *   - Usage tracking (last used, request count)
 *   - Rate limiting per key
 *   - Revocation
 *
 * Key format: `aal_<scope>_<random_hex>` (e.g., `aal_rw_a1b2c3d4e5f6...`)
 *
 * Storage: Keys are stored as SHA-256 hashes — the plaintext key is only
 * returned once at creation time and cannot be recovered.
 */

import { randomBytes, createHash } from 'crypto'
import type { Pool } from 'pg'

// ── Types ────────────────────────────────────────────────────────────

export type ApiKeyScope = 'read' | 'write' | 'admin'

export interface ApiKeyRecord {
  id: string
  name: string
  key_prefix: string        // first 8 chars for display (e.g., "aal_rw_a1")
  key_hash: string          // SHA-256 of full key
  scopes: ApiKeyScope[]
  user_id: string
  created_at: number
  expires_at: number | null
  last_used_at: number
  request_count: number
  rate_limit_per_min: number
  is_active: boolean
}

export interface CreateApiKeyResult {
  id: string
  name: string
  key: string               // plaintext — only returned at creation
  key_prefix: string
  scopes: ApiKeyScope[]
  expires_at: number | null
  rate_limit_per_min: number
}

export interface ValidatedKey {
  id: string
  user_id: string
  scopes: ApiKeyScope[]
  rate_limit_per_min: number
}

// ── Key Generation ───────────────────────────────────────────────────

/** Generate a new API key with the given scope prefix */
export function generateApiKey(scopes: ApiKeyScope[]): string {
  const scopePrefix = scopes.includes('admin') ? 'adm'
    : scopes.includes('write') ? 'rw'
    : 'ro'
  const random = randomBytes(32).toString('hex')
  return `aal_${scopePrefix}_${random}`
}

/** Hash an API key for storage */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/** Extract the display prefix from a key */
export function keyPrefix(key: string): string {
  return key.slice(0, 12) + '...'
}

// ── Validation ───────────────────────────────────────────────────────

/** Validate an API key against the database */
export async function validateApiKey(
  pool: Pool,
  key: string
): Promise<ValidatedKey | null> {
  const hash = hashApiKey(key)
  const now = Date.now()

  const { rows } = await pool.query<{
    id: string; user_id: string; scopes: string;
    rate_limit_per_min: number; expires_at: string | null; is_active: boolean
  }>(
    `SELECT id, user_id, scopes, rate_limit_per_min, expires_at, is_active
     FROM aaelink.api_keys
     WHERE key_hash = $1`,
    [hash]
  )

  if (!rows[0]) return null

  const record = rows[0]

  // Check active
  if (!record.is_active) return null

  // Check expiration
  if (record.expires_at && Number(record.expires_at) < now) return null

  // Update usage stats (fire-and-forget)
  pool.query(
    `UPDATE aaelink.api_keys SET last_used_at = $1, request_count = request_count + 1 WHERE id = $2`,
    [now, record.id]
  ).catch(() => {})

  const scopes = (typeof record.scopes === 'string'
    ? JSON.parse(record.scopes)
    : record.scopes) as ApiKeyScope[]

  return {
    id: record.id,
    user_id: record.user_id,
    scopes,
    rate_limit_per_min: record.rate_limit_per_min,
  }
}

/** Check if a validated key has the required scope */
export function hasScope(key: ValidatedKey, required: ApiKeyScope): boolean {
  // Admin scope implies all permissions
  if (key.scopes.includes('admin')) return true
  // Write scope implies read
  if (required === 'read' && key.scopes.includes('write')) return true
  return key.scopes.includes(required)
}

// ── CRUD Operations ──────────────────────────────────────────────────

/** Create a new API key */
export async function createApiKey(
  pool: Pool,
  opts: {
    name: string
    scopes: ApiKeyScope[]
    userId: string
    expiresAt?: number | null
    rateLimitPerMin?: number
  }
): Promise<CreateApiKeyResult> {
  const { randomUUID } = await import('crypto')
  const id = randomUUID()
  const key = generateApiKey(opts.scopes)
  const hash = hashApiKey(key)
  const prefix = keyPrefix(key)
  const now = Date.now()
  const rateLimit = opts.rateLimitPerMin || 60

  await pool.query(
    `INSERT INTO aaelink.api_keys (id, name, key_prefix, key_hash, scopes, user_id, created_at, expires_at, last_used_at, request_count, rate_limit_per_min, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, $9, true)`,
    [id, opts.name, prefix, hash, JSON.stringify(opts.scopes), opts.userId, now, opts.expiresAt || null, rateLimit]
  )

  return {
    id,
    name: opts.name,
    key,
    key_prefix: prefix,
    scopes: opts.scopes,
    expires_at: opts.expiresAt || null,
    rate_limit_per_min: rateLimit,
  }
}

/** Revoke an API key */
export async function revokeApiKey(pool: Pool, keyId: string, userId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE aaelink.api_keys SET is_active = false WHERE id = $1 AND user_id = $2`,
    [keyId, userId]
  )
  return (rowCount ?? 0) > 0
}

/** List API keys for a user (hashes hidden) */
export async function listApiKeys(pool: Pool, userId: string): Promise<Omit<ApiKeyRecord, 'key_hash'>[]> {
  const { rows } = await pool.query(
    `SELECT id, name, key_prefix, scopes, user_id, created_at, expires_at,
            last_used_at, request_count, rate_limit_per_min, is_active
     FROM aaelink.api_keys
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  )

  return rows.map(r => ({
    ...r,
    scopes: typeof r.scopes === 'string' ? JSON.parse(r.scopes as string) : r.scopes,
    created_at: Number(r.created_at),
    expires_at: r.expires_at ? Number(r.expires_at) : null,
    last_used_at: Number(r.last_used_at),
    request_count: Number(r.request_count),
  })) as Omit<ApiKeyRecord, 'key_hash'>[]
}
