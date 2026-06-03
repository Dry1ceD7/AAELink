import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { resolveOAuthToken } from '@/lib/api/oauthScopes'

/**
 * POST /api/oauth/introspect (D7) — OAuth token introspection (RFC 7662-style).
 * Body: { token }. Returns { active, scope, app_id, user_id, token_type, exp }.
 * Inactive (unknown or expired) tokens return { active: false } only.
 */
async function _POST(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { token?: string }
  const token = String(body.token || '').trim()
  if (!token) return NextResponse.json({ error: 'token_required' }, { status: 400 })

  const grant = await resolveOAuthToken(pool, token)
  const expired = !!grant && grant.expires_at > 0 && grant.expires_at <= Date.now()
  if (!grant || expired) return NextResponse.json({ active: false })

  return NextResponse.json({
    active: true,
    app_id: grant.app_id,
    user_id: grant.user_id,
    workspace_id: grant.workspace_id,
    token_type: grant.token_type,
    scope: grant.scopes.join(' '),
    exp: grant.expires_at || null,
  })
}

export const POST = tracedRoute('POST', '/api/oauth/introspect', _POST)
