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
import { NextResponse } from 'next/server'

// ── Scope catalog ────────────────────────────────────────────────────────────
// Mirrors Slack scope naming. Add new scopes here and map them to routes below.
//
//   chat:write        POST /api/messages
//   chat:read         GET  /api/messages
//   channels:read     GET  /api/channels
//   channels:write    POST /api/channels, PATCH /api/channels, DELETE /api/channels
//   users:read        GET  /api/users/directory
//   files:read        GET  /api/files
//   files:write       DELETE /api/files
//   search:read       GET  /api/search/*  (wired separately — see follow-ups)
//
export const SCOPES = {
  CHAT_WRITE:     'chat:write',
  CHAT_READ:      'chat:read',
  CHANNELS_READ:  'channels:read',
  CHANNELS_WRITE: 'channels:write',
  USERS_READ:     'users:read',
  FILES_READ:     'files:read',
  FILES_WRITE:    'files:write',
  SEARCH_READ:    'search:read',
} as const

export type Scope = (typeof SCOPES)[keyof typeof SCOPES]

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

/**
 * Tenant binding for a bearer-token grant. A token minted for one workspace
 * must not act on resources in another workspace, even when the underlying
 * user/bot has cross-workspace membership. An empty grant.workspace_id means
 * the token is not workspace-scoped (legacy/unscoped grant) and imposes no
 * tenant restriction. A non-empty grant.workspace_id must match the resource's
 * workspace exactly. An empty/absent resource workspace never matches a scoped
 * grant (fail closed).
 */
export function grantWorkspaceMatches(grant: OAuthGrant, resourceWorkspaceId: string): boolean {
  const granted = String(grant.workspace_id || '').trim()
  if (!granted) return true
  return granted === String(resourceWorkspaceId || '').trim()
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

// ── Bot-token resolution ─────────────────────────────────────────────────────
// Bot users store their own api_token (xbot-* prefix) in bot_users.api_token.
// They also carry a JSONB scopes array on the bot_users row. We normalise them
// into the same OAuthGrant shape so enforceScope can treat them uniformly.

async function resolveBotToken(pool: Pool, token: string): Promise<OAuthGrant | null> {
  const { rows } = await pool.query<{
    id: string; created_by: string | null; workspace_id: string | null
    scopes: string | string[]; status: string
  }>(
    `SELECT id, created_by, workspace_id, scopes, status
       FROM aaelink.bot_users WHERE api_token = $1`,
    [token]
  )
  const row = rows[0]
  if (!row || row.status !== 'active') return null
  // scopes is stored as JSONB — pg driver returns it already parsed
  const rawScopes: unknown = row.scopes
  const scopeList: string[] = Array.isArray(rawScopes)
    ? rawScopes.filter((s): s is string => typeof s === 'string')
    : parseScopes(String(rawScopes || ''))
  return {
    token_id: row.id,
    app_id:   row.id,
    user_id:  row.created_by ?? row.id,
    workspace_id: row.workspace_id ?? '',
    token_type: 'bot',
    scopes: scopeList,
    expires_at: 0, // bot tokens don't expire
  }
}

// ── enforceScope ─────────────────────────────────────────────────────────────

export type EnforceScopeResult =
  | { kind: 'no_token' }
  | { kind: 'ok'; grant: OAuthGrant }
  | { kind: 'error'; response: NextResponse }

/**
 * Dual-auth scope gate for bearer-token API routes.
 *
 * Reads the `Authorization: Bearer <token>` header from `req`.
 *
 * - No bearer header → returns `{ kind: 'no_token' }` so the caller falls
 *   through to normal cookie-session auth (unchanged behaviour for browsers).
 * - Valid token with required scope → `{ kind: 'ok', grant }`. The caller
 *   MUST use `grant.user_id` as the acting user and SKIP session + CSRF checks
 *   (the bearer token IS the authentication credential).
 * - Invalid/expired/insufficient → `{ kind: 'error', response }` with the
 *   appropriate HTTP response (401 with WWW-Authenticate, or 403).
 *
 * Bot tokens (xbot-* prefix) are resolved through the bot_users table;
 * OAuth user tokens are resolved through oauth_tokens.
 */
export async function enforceScope(
  pool: Pool,
  req: Request,
  requiredScope: string,
  now = Date.now()
): Promise<EnforceScopeResult> {
  const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization') ?? ''
  const match = /^Bearer\s+(\S+)$/i.exec(authHeader.trim())
  if (!match) return { kind: 'no_token' }

  const token = match[1]

  // Try bot token first (xbot-* prefix, stored in bot_users.api_token)
  const isBotToken = token.startsWith('xbot-')
  const grant = isBotToken
    ? await resolveBotToken(pool, token)
    : await resolveOAuthToken(pool, token)

  if (!grant) {
    return {
      kind: 'error',
      response: NextResponse.json(
        { error: 'invalid_token' },
        {
          status: 401,
          headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' },
        }
      ),
    }
  }

  if (grant.expires_at > 0 && grant.expires_at <= now) {
    return {
      kind: 'error',
      response: NextResponse.json(
        { error: 'token_expired' },
        {
          status: 401,
          headers: { 'WWW-Authenticate': 'Bearer error="token_expired"' },
        }
      ),
    }
  }

  if (!scopeSatisfied(grant.scopes, requiredScope)) {
    return {
      kind: 'error',
      response: NextResponse.json(
        { error: 'insufficient_scope', required: requiredScope },
        {
          status: 403,
          headers: {
            'WWW-Authenticate': `Bearer error="insufficient_scope", scope="${requiredScope}"`,
          },
        }
      ),
    }
  }

  return { kind: 'ok', grant }
}
