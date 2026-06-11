import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { resolveOAuthToken, rotateToken } from '@/lib/api/oauthScopes'

/**
 * POST /api/oauth/rotate (D7) — rotate an OAuth token's secret. Body: { token }.
 * Allowed for the token's owner or a platform admin. Returns the new token once.
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
  if (!grant) return NextResponse.json({ error: 'invalid_token' }, { status: 404 })

  const { rows } = await pool.query(`SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid])
  const admin = isPlatformAdmin((rows[0] as { platform_role?: string })?.platform_role || '')
  if (grant.user_id !== uid && !admin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const result = await rotateToken(pool, token)
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: 404 })

  writeAuditLog({
    pool,
    actorId: uid,
    action: 'oauth.token.rotate',
    resourceKind: 'oauth_token',
    resourceId: result.tokenId,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
    metadata: { app_id: grant.app_id },
  })

  return NextResponse.json({ ok: true, token: result.token, token_id: result.tokenId })
}

export const POST = tracedRoute('POST', '/api/oauth/rotate', _POST)
