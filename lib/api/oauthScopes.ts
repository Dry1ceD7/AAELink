/**
 * D7 Developer platform — OAuth token scope enforcement + rotation.
 *
 * oauth_apps / oauth_tokens and a token-grant route existed, but the granted
 * scope was never checked and tokens could not be rotated. This is the
 * enforcement layer: resolve a bearer token to its grant, test whether it
 * carries a required scope, and rotate a token's secret in place.
 *
 * Scope model (flat strings, Slack-like). A required scope is satisfied when the
 * grant contains it exactly, holds the `admin` super-scope, or holds a
 * resource wildcard — e.g. `chat:*` satisfies `chat:write`.
 */
import type { Pool } from 'pg'
import { randomUUID } from 'crypto'

/** Split a stored scope string (space- or comma-separated) into a clean list. */
export function parseScopes(scope: string): string[] {
  return String(scope || '')
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(Boolean)
}

/** Whether a granted scope set satisfies a single required scope. */
export function scopeSatisfied(granted: string[], required: string): boolean {
  if (!required) return true
  if (granted.includes(required)) return true
  if (granted.includes('admin')) return true
  const resource = required.split(':')[0]
  return granted.includes(`${resource}:*`)
}

export interface OAuthGrant {
  token_id: string
  app_id: string
  user_id: string
  workspace_id: string
  token_type: string
  scopes: string[]
  expires_at: number
}

/** Resolve a bearer token to its grant, or null when unknown. */
export async function resolveOAuthToken(pool: Pool, token: string): Promise<OAuthGrant | null> {
  const t = String(token || '').trim()
  if (!t) return null
  const { rows } = await pool.query<{
    id: string; app_id: string; user_id: string; workspace_id: string
    token_type: string; scope: string; expires_at: string
  }>(
    `SELECT id, app_id, user_id, workspace_id, token_type, scope, expires_at::text AS expires_at
       FROM aaelink.oauth_tokens WHERE token = $1`,
    [t]
  )
  const row = rows[0]
  if (!row) return null
  return {
    token_id: row.id,
    app_id: row.app_id,
    user_id: row.user_id,
    workspace_id: row.workspace_id,
    token_type: row.token_type,
    scopes: parseScopes(row.scope),
    expires_at: Number(row.expires_at),
  }
}

export type RequireScopeResult =
  | { ok: true; grant: OAuthGrant }
  | { ok: false; code: 'invalid_token' | 'token_expired' | 'insufficient_scope' }

/**
 * Resolve a bearer token and assert it carries `requiredScope`. The single
 * gate a Web API route calls: rejects unknown/expired tokens and tokens lacking
 * the scope.
 */
export async function requireScope(
  pool: Pool,
  token: string,
  requiredScope: string,
  now = Date.now()
): Promise<RequireScopeResult> {
  const grant = await resolveOAuthToken(pool, token)
  if (!grant) return { ok: false, code: 'invalid_token' }
  if (grant.expires_at > 0 && grant.expires_at <= now) return { ok: false, code: 'token_expired' }
  if (!scopeSatisfied(grant.scopes, requiredScope)) return { ok: false, code: 'insufficient_scope' }
  return { ok: true, grant }
}

export type RotateTokenResult =
  | { ok: true; token: string; tokenId: string }
  | { ok: false; code: 'invalid_token' }

/**
 * Rotate a token's secret in place: issue a new value for the same grant and
 * invalidate the old one. Scopes, app, user, and expiry are preserved.
 */
export async function rotateToken(pool: Pool, oldToken: string, now = Date.now()): Promise<RotateTokenResult> {
  const newToken = `aaelink_oat_${randomUUID().replace(/-/g, '')}`
  const { rows } = await pool.query<{ id: string }>(
    `UPDATE aaelink.oauth_tokens SET token = $2, created_at = $3 WHERE token = $1 RETURNING id`,
    [String(oldToken || '').trim(), newToken, now]
  )
  if (!rows[0]) return { ok: false, code: 'invalid_token' }
  return { ok: true, token: newToken, tokenId: rows[0].id }
}
