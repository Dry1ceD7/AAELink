import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { SESSION_COOKIE, sessionCookieSecure, createSession } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { clientMeta } from '@/lib/auth/ssoRouteHelpers'
import { beginPasswordlessLogin, finishPasswordlessLogin } from '@/lib/auth/webauthn'
import type { AuthenticationResponseJSON } from '@simplewebauthn/server'

/**
 * Passwordless (usernameless) login with a discoverable passkey (ADR 0016).
 *
 * POST { action: 'begin' }            — authentication options for any resident
 *                                       key; the challenge is stashed in a
 *                                       short-lived httpOnly cookie (no session
 *                                       exists yet to hold it).
 * POST { action: 'finish', response } — verify the assertion, resolve the owning
 *                                       user from the credential, and establish
 *                                       a normal session.
 *
 * No CSRF: this IS the sign-in handshake; there is no session to protect yet.
 */
const CHALLENGE_COOKIE = 'WEBAUTHN_LOGIN_CHALLENGE'

async function _POST(req: Request) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const body = (await req.json().catch(() => ({}))) as {
    action?: 'begin' | 'finish'; response?: AuthenticationResponseJSON
  }

  if (body.action === 'begin') {
    const options = await beginPasswordlessLogin()
    const res = NextResponse.json({ options })
    res.cookies.set(CHALLENGE_COOKIE, options.challenge, {
      httpOnly: true, sameSite: 'lax', secure: sessionCookieSecure(), path: '/', maxAge: 300,
    })
    return res
  }

  if (body.action === 'finish') {
    if (!body.response) return NextResponse.json({ error: 'response_required' }, { status: 400 })
    const challenge = (await cookies()).get(CHALLENGE_COOKIE)?.value?.trim()
    if (!challenge) return NextResponse.json({ error: 'no_login_challenge' }, { status: 400 })

    let userId: string | null
    try {
      userId = await finishPasswordlessLogin(pool, body.response, challenge)
    } catch {
      userId = null
    }
    if (!userId) return NextResponse.json({ error: 'invalid_passkey' }, { status: 401 })

    const meta = clientMeta(req)
    const { sessionId, sessionMs } = await createSession(pool, userId, meta)
    await pool.query(
      `UPDATE aaelink.users SET last_seen_at = $1, last_login_at = $1,
              login_count = COALESCE(login_count, 0) + 1 WHERE id = $2`,
      [Date.now(), userId]
    ).catch(() => { /* non-critical */ })

    const res = NextResponse.json({ ok: true, user_id: userId })
    res.cookies.set(SESSION_COOKIE, sessionId, {
      httpOnly: true, sameSite: 'lax', secure: sessionCookieSecure(), path: '/',
      maxAge: Math.floor(sessionMs / 1000),
    })
    res.cookies.set(CHALLENGE_COOKIE, '', { path: '/', maxAge: 0 })
    return res
  }

  return NextResponse.json({ error: 'action required (begin|finish)' }, { status: 400 })
}

export const POST = tracedRoute('POST', '/api/auth/webauthn/login', _POST)
