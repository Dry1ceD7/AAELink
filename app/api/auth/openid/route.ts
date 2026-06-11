import { NextRequest, NextResponse } from 'next/server'
import { createHash, randomBytes } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * OpenID Connect API — Slack openid.connect parity.
 *
 * POST /api/auth/openid — OpenID Connect token exchange & userinfo
 *   Actions:
 *     - token    — exchange auth code for ID token + access token
 *     - userinfo — get user profile from access token
 */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const body = (await req.json().catch(() => ({}))) as {
    action?: string
    code?: string
    client_id?: string
    client_secret?: string
    redirect_uri?: string
    access_token?: string
    grant_type?: string
  }

  if (body.action === 'token' || body.grant_type === 'authorization_code') {
    if (!body.code || !body.client_id || !body.client_secret) {
      return NextResponse.json({ error: 'missing_params', detail: 'code, client_id, and client_secret required' }, { status: 400 })
    }

    // Validate client credentials
    const { rows: clients } = await pool.query<{ id: string; secret_hash: string; redirect_uris: string }>(
      `SELECT id, secret_hash, redirect_uris FROM aaelink.oauth_clients WHERE client_id = $1`,
      [body.client_id]
    ).catch(() => ({ rows: [] as { id: string; secret_hash: string; redirect_uris: string }[] }))

    if (!clients[0]) {
      return NextResponse.json({ error: 'invalid_client' }, { status: 401 })
    }

    const secretHash = createHash('sha256').update(body.client_secret).digest('hex')
    if (clients[0].secret_hash !== secretHash) {
      return NextResponse.json({ error: 'invalid_client_secret' }, { status: 401 })
    }

    // Exchange auth code
    const { rows: codes } = await pool.query<{ user_id: string; scope: string }>(
      `SELECT user_id, scope FROM aaelink.auth_codes WHERE code = $1 AND expires_at > $2`,
      [body.code, Date.now()]
    ).catch(() => ({ rows: [] as { user_id: string; scope: string }[] }))

    if (!codes[0]) {
      return NextResponse.json({ error: 'invalid_code' }, { status: 400 })
    }

    // Consume the code
    await pool.query(`DELETE FROM aaelink.auth_codes WHERE code = $1`, [body.code]).catch(() => {})

    // Generate tokens
    const accessToken = randomBytes(32).toString('hex')
    const idToken = generateIdToken(codes[0].user_id, body.client_id)

    // Store access token
    await pool.query(
      `INSERT INTO aaelink.oauth_tokens (token_hash, user_id, client_id, scope, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [createHash('sha256').update(accessToken).digest('hex'), codes[0].user_id, body.client_id, codes[0].scope, Date.now(), Date.now() + 3600000]
    ).catch(() => {})

    return NextResponse.json({
      ok: true,
      access_token: accessToken,
      token_type: 'Bearer',
      id_token: idToken,
      scope: codes[0].scope || 'openid profile email',
      expires_in: 3600,
    })
  }

  if (body.action === 'userinfo') {
    const token = body.access_token || req.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) return NextResponse.json({ error: 'missing_token' }, { status: 401 })

    const tokenHash = createHash('sha256').update(token).digest('hex')
    const { rows: tokens } = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM aaelink.oauth_tokens WHERE token_hash = $1 AND expires_at > $2`,
      [tokenHash, Date.now()]
    ).catch(() => ({ rows: [] as { user_id: string }[] }))

    if (!tokens[0]) return NextResponse.json({ error: 'invalid_token' }, { status: 401 })

    const { rows: users } = await pool.query<{
      id: string; username: string; email: string;
      first_name: string; last_name: string; avatar_url: string; display_name: string;
    }>(
      `SELECT id, username, email, first_name, last_name, avatar_url, display_name
       FROM aaelink.users WHERE id = $1`,
      [tokens[0].user_id]
    )

    if (!users[0]) return NextResponse.json({ error: 'user_not_found' }, { status: 404 })

    const u = users[0]
    return NextResponse.json({
      ok: true,
      sub: u.id,
      name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.display_name || u.username,
      given_name: u.first_name || '',
      family_name: u.last_name || '',
      email: u.email,
      picture: u.avatar_url || '',
      locale: 'en-US',
    })
  }

  return NextResponse.json({ error: 'unknown_action', detail: 'Use action=token or action=userinfo' }, { status: 400 })
}

function generateIdToken(userId: string, clientId: string): string {
  // Simplified JWT-like structure (in production, use proper JWT signing)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://aaelink.aae.co.th',
    sub: userId,
    aud: clientId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    nonce: randomBytes(16).toString('hex'),
  })).toString('base64url')
  const signature = createHash('sha256').update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

export const POST = tracedRoute('POST', '/api/auth/openid', _POST)
