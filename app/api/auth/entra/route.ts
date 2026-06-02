import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { randomUUID } from 'crypto'
import { SESSION_COOKIE, sessionCookieSecure } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

const AUTHORITY = 'https://login.microsoftonline.com'
const SESSION_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000

async function _GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const code = url.searchParams.get('code')
    const action = url.searchParams.get('action') || 'init'

    const pool = getPool()
    if (!pool) return NextResponse.json({ error: 'DB unavailable' }, { status: 500 })

    const ssoRes = await pool.query(`SELECT * FROM aaelink.sso_configs WHERE provider = 'entra' AND is_enabled = true`)
    const config = ssoRes.rows[0]
    if (!config) {
      return NextResponse.redirect(new URL('/login?error=sso_disabled', req.url))
    }

    const { tenant_id, client_id, client_secret } = config
    const redirectUri = `${url.origin}/api/auth/entra`

    if (action === 'init' || (!code && action !== 'init')) {
      const authUrl = new URL(`${AUTHORITY}/${tenant_id}/oauth2/v2.0/authorize`)
      authUrl.searchParams.set('client_id', client_id)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('redirect_uri', redirectUri)
      authUrl.searchParams.set('response_mode', 'query')
      authUrl.searchParams.set('scope', 'openid profile email User.Read')
      return NextResponse.redirect(authUrl.toString())
    }

    if (code) {
      const tokenUrl = `${AUTHORITY}/${tenant_id}/oauth2/v2.0/token`
      const params = new URLSearchParams()
      params.append('client_id', client_id)
      params.append('client_secret', client_secret)
      params.append('code', code)
      params.append('redirect_uri', redirectUri)
      params.append('grant_type', 'authorization_code')

      const tokenRes = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      })

      if (!tokenRes.ok) {
        return NextResponse.redirect(new URL('/login?error=sso_failed', req.url))
      }

      const tokenData = await tokenRes.json()
      const accessToken = tokenData.access_token

      const profileRes = await fetch('https://graph.microsoft.com/v1.0/me?$select=id,displayName,givenName,surname,mail,userPrincipalName', {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      })

      if (!profileRes.ok) {
        return NextResponse.redirect(new URL('/login?error=sso_profile_failed', req.url))
      }

      const profileData = await profileRes.json()
      const email = (profileData.mail || profileData.userPrincipalName).toLowerCase()
      const firstName = profileData.givenName || ''
      const lastName = profileData.surname || ''
      const displayName = profileData.displayName || email.split('@')[0]

      const userRes = await pool.query(`SELECT id FROM aaelink.users WHERE email = $1`, [email])
      let userId = ''

      if (userRes.rows.length === 0) {
        userId = randomUUID()
        const now = Date.now()
        await pool.query(`
          INSERT INTO aaelink.users (id, username, email, password_hash, first_name, last_name, nickname, created_at, last_seen_at, platform_role)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, '')
        `, [
          userId, 
          email.split('@')[0] + '_' + Math.floor(Math.random() * 1000), 
          email, 
          'sso_managed',
          firstName, 
          lastName, 
          displayName, 
          now
        ])
      } else {
        userId = userRes.rows[0].id
      }

      const sessionId = randomUUID()
      const now = Date.now()
      const expiresAt = now + SESSION_EXPIRY_MS
      
      const userAgent = req.headers.get('user-agent') || ''
      const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || ''
      
      await pool.query(`
        INSERT INTO aaelink.sessions (id, user_id, expires_at, user_agent, ip_address, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [sessionId, userId, expiresAt, userAgent, ipAddress, now])

      const response = NextResponse.redirect(new URL('/home', req.url))
      response.cookies.set(SESSION_COOKIE, sessionId, {
        httpOnly: true,
        sameSite: 'lax',
        secure: sessionCookieSecure(),
        path: '/',
        maxAge: Math.floor(SESSION_EXPIRY_MS / 1000)
      })
      return response
    }

    return NextResponse.redirect(new URL('/login?error=invalid_request', req.url))
  } catch (error: unknown) {
    console.error('Entra ID SSO Error:', error instanceof Error ? error.message : error)
    return NextResponse.redirect(new URL('/login?error=sso_error', req.url))
  }
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/auth/entra', _GET)
