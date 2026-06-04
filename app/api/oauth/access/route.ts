import { randomBytes, randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * OAuth2 API — Slack oauth.v2.access / auth.revoke parity.
 *
 * POST /api/oauth/access — exchange authorization code for access token
 * GET  /api/oauth/access — get current token info
 *
 * Supports:
 *   - Authorization code exchange
 *   - Token info/introspection
 *   - Bot/user token differentiation
 *   - Scope validation
 *
 * Access-token TTL: 12 hours. The authorization-code flow here mints a real
 * user-delegated token (token_type 'user', bound to codeRow.user_id), so it
 * must carry a finite lifetime — expires_at = now + ACCESS_TOKEN_TTL_MS. The
 * worker prune (lib/infra/worker.ts) and the requireScope/introspect expiry
 * checks (lib/api/oauthScopes.ts, app/api/oauth/introspect/route.ts) only act on
 * tokens with expires_at > 0, so a hardcoded 0 ("never expires") would make
 * every issued credential immortal and unrevocable except by manual delete.
 */
const ACCESS_TOKEN_TTL_MS = 12 * 60 * 60 * 1000

async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const token = req.nextUrl.searchParams.get('token') || req.headers.get('authorization')?.replace('Bearer ', '') || ''

  if (token) {
    // Token introspection
    const { rows } = await pool.query<{
      id: string; token: string; token_type: string; app_id: string;
      user_id: string; workspace_id: string; scope: string; expires_at: number;
    }>(
      `SELECT * FROM aaelink.oauth_tokens WHERE token = $1`, [token]
    )
    if (!rows[0]) return NextResponse.json({ ok: false, error: 'invalid_token' }, { status: 401 })

    const t = rows[0]
    // expires_at is a BIGINT — pg returns it as a string, so coerce to a number
    // (mirrors resolveOAuthToken in lib/api/oauthScopes.ts).
    return NextResponse.json({
      ok: true,
      token_type: t.token_type || 'bot',
      app_id: t.app_id || '',
      user_id: t.user_id || '',
      team_id: t.workspace_id || '',
      scope: t.scope || '',
      expires_at: Number(t.expires_at) || 0,
    })
  }

  // List user's authorized apps
  const { rows } = await pool.query(
    `SELECT DISTINCT app_id, scope, created_at FROM aaelink.oauth_tokens WHERE user_id = $1`,
    [uid]
  )

  return NextResponse.json({ ok: true, authorizations: rows })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const body = (await req.json().catch(() => ({}))) as {
    action?: 'exchange' | 'revoke'
    code?: string; client_id?: string; client_secret?: string; redirect_uri?: string
    token?: string
  }

  const action = body.action || 'exchange'

  if (action === 'exchange') {
    const code = String(body.code || '').trim()
    const clientId = String(body.client_id || '').trim()
    const clientSecret = String(body.client_secret || '').trim()
    const redirectUri = String(body.redirect_uri || '').trim()
    if (!code || !clientId || !clientSecret || !redirectUri) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
    }

    // Verify app credentials — no dev fallback. An unknown client or a bad
    // secret is rejected outright (Slack/OAuth2 invalid_client).
    const { rows: appRows } = await pool.query<{ id: string; is_active: boolean }>(
      `SELECT id, is_active FROM aaelink.oauth_apps
        WHERE client_id = $1 AND client_secret = $2`,
      [clientId, clientSecret]
    )
    const app = appRows[0]
    if (!app || app.is_active === false) {
      return NextResponse.json({ error: 'invalid_client' }, { status: 401 })
    }

    const now = Date.now()

    // Atomically consume the authorization code: single-use + not expired.
    const { rows: codeRows } = await pool.query<{
      app_id: string; client_id: string; user_id: string
      workspace_id: string; redirect_uri: string; scope: string
    }>(
      `UPDATE aaelink.oauth_codes
          SET used_at = $2
        WHERE code = $1 AND used_at IS NULL AND expires_at > $2
      RETURNING app_id, client_id, user_id, workspace_id, redirect_uri, scope`,
      [code, now]
    )
    const codeRow = codeRows[0]
    if (!codeRow) {
      return NextResponse.json({ error: 'invalid_code' }, { status: 400 })
    }
    // The code must have been issued to this exact client + redirect_uri.
    if (codeRow.client_id !== clientId || codeRow.redirect_uri !== redirectUri) {
      return NextResponse.json({ error: 'invalid_grant' }, { status: 400 })
    }

    // Mint a real user-delegated access token with crypto-strong entropy.
    // token_type is 'user' (this grant is bound to codeRow.user_id, not a bot
    // identity) and it carries a finite expires_at so the worker prune and the
    // requireScope/introspect expiry checks apply.
    const accessToken = `xoxp-${randomBytes(24).toString('hex')}`
    const scope = codeRow.scope || ''
    const expiresAt = now + ACCESS_TOKEN_TTL_MS
    await pool.query(
      `INSERT INTO aaelink.oauth_tokens
         (id, token, token_type, app_id, user_id, workspace_id, scope, expires_at, created_at)
       VALUES ($1, $2, 'user', $3, $4, $5, $6, $7, $8)`,
      [randomUUID(), accessToken, app.id, codeRow.user_id, codeRow.workspace_id || '', scope, expiresAt, now]
    )

    writeAuditLog({
      pool,
      actorId: codeRow.user_id,
      action: 'oauth.token.issue',
      resourceKind: 'oauth_token',
      resourceId: app.id,
      ipAddress: extractIp(req),
      userAgent: req.headers.get('user-agent') || '',
      metadata: { client_id: clientId, scope, token_type: 'user', expires_at: expiresAt },
    })

    return NextResponse.json({
      ok: true,
      access_token: accessToken,
      token_type: 'user',
      scope,
      app_id: app.id,
      expires_at: expiresAt,
      team: { id: codeRow.workspace_id || '', name: 'AAELink' },
      authed_user: { id: codeRow.user_id, scope, access_token: accessToken },
    })
  }

  if (action === 'revoke') {
    if (!body.token) return NextResponse.json({ ok: false, error: 'token required' }, { status: 400 })
    try {
      await pool.query(`DELETE FROM aaelink.oauth_tokens WHERE token = $1`, [body.token])
    } catch { /* */ }
    return NextResponse.json({ ok: true, revoked: true })
  }

  return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/oauth/access', _GET)
export const POST   = tracedRoute('POST', '/api/oauth/access', _POST)
