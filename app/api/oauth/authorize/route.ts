import { randomBytes, randomUUID } from 'crypto'
import type { Pool } from 'pg'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { parseScopes } from '@/lib/api/oauthScopes'

/**
 * OAuth2 authorization endpoint — Slack oauth.v2 parity (authorization-code flow).
 *
 * GET  /api/oauth/authorize — session required. Validates client_id +
 *      redirect_uri and returns app info for a consent screen.
 * POST /api/oauth/authorize — session + CSRF. Issues a single-use, 10-minute
 *      authorization code bound to the user, client, redirect_uri, and granted
 *      scope. The client later trades the code at POST /api/oauth/access.
 *
 * Authorization-code TTL: 10 minutes (single-use).
 */
const CODE_TTL_MS = 10 * 60 * 1000

interface OAuthApp {
  id: string
  name: string
  client_id: string
  redirect_uris: string[]
  scopes: string
}

/**
 * Resolve a client by client_id and validate the redirect_uri against the app's
 * registered list. Returns the app and the granted (intersected) scope, or an
 * error code mapped to the right status.
 */
async function validateAuthorizeRequest(
  pool: Pool,
  clientId: string,
  redirectUri: string,
  requestedScope: string,
): Promise<
  | { ok: true; app: OAuthApp; grantedScope: string }
  | { ok: false; status: number; error: string }
> {
  if (!clientId) return { ok: false, status: 400, error: 'client_id_required' }
  if (!redirectUri) return { ok: false, status: 400, error: 'redirect_uri_required' }

  const { rows } = await pool.query<{
    id: string; name: string; client_id: string; redirect_uris: string[]; scopes: string; is_active: boolean
  }>(
    `SELECT id, name, client_id, redirect_uris, scopes, is_active
       FROM aaelink.oauth_apps WHERE client_id = $1`,
    [clientId],
  )
  const row = rows[0]
  if (!row || row.is_active === false) return { ok: false, status: 404, error: 'unknown_client' }

  const registered = Array.isArray(row.redirect_uris) ? row.redirect_uris : []
  if (!registered.includes(redirectUri)) {
    return { ok: false, status: 400, error: 'redirect_uri_mismatch' }
  }

  // Granted scope: when the app registers scopes, intersect requested with the
  // registered set; otherwise pass the requested scope through unchanged.
  const requested = parseScopes(requestedScope)
  const appScopes = parseScopes(row.scopes)
  let grantedList: string[]
  if (appScopes.length === 0) {
    grantedList = requested
  } else if (requested.length === 0) {
    grantedList = appScopes
  } else {
    grantedList = requested.filter(s => appScopes.includes(s))
  }

  return {
    ok: true,
    app: {
      id: row.id,
      name: row.name || '',
      client_id: row.client_id,
      redirect_uris: registered,
      scopes: row.scopes || '',
    },
    grantedScope: grantedList.join(' '),
  }
}

async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const clientId = String(req.nextUrl.searchParams.get('client_id') || '').trim()
  const redirectUri = String(req.nextUrl.searchParams.get('redirect_uri') || '').trim()
  const scope = String(req.nextUrl.searchParams.get('scope') || '').trim()
  const state = String(req.nextUrl.searchParams.get('state') || '')

  const v = await validateAuthorizeRequest(pool, clientId, redirectUri, scope)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status })

  return NextResponse.json({
    ok: true,
    app: {
      name: v.app.name,
      client_id: v.app.client_id,
      scope: v.grantedScope,
    },
    redirect_uri: redirectUri,
    state,
  })
}

async function _POST(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    client_id?: string; redirect_uri?: string; scope?: string; state?: string
  }
  const clientId = String(body.client_id || '').trim()
  const redirectUri = String(body.redirect_uri || '').trim()
  const scope = String(body.scope || '').trim()
  const hasState = typeof body.state === 'string'
  const state = hasState ? String(body.state) : ''

  const v = await validateAuthorizeRequest(pool, clientId, redirectUri, scope)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status })

  const now = Date.now()
  const code = randomBytes(24).toString('hex')
  await pool.query(
    `INSERT INTO aaelink.oauth_codes
       (id, code, app_id, client_id, user_id, redirect_uri, scope, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [randomUUID(), code, v.app.id, v.app.client_id, uid, redirectUri, v.grantedScope, now + CODE_TTL_MS, now],
  )

  writeAuditLog({
    pool,
    actorId: uid,
    action: 'oauth.authorize.grant',
    resourceKind: 'oauth_app',
    resourceId: v.app.id,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
    metadata: { client_id: v.app.client_id, scope: v.grantedScope },
  })

  // State passthrough is verbatim and only when the client provided it.
  const url = new URL(redirectUri)
  url.searchParams.set('code', code)
  if (hasState) url.searchParams.set('state', state)

  return NextResponse.json({ ok: true, code, redirect_to: url.toString() })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET  = tracedRoute('GET', '/api/oauth/authorize', _GET)
export const POST = tracedRoute('POST', '/api/oauth/authorize', _POST)
