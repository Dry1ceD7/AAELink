import { NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readMfaPendingSession, clearMfaPending } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { beginAuthentication, finishAuthentication } from '@/lib/auth/webauthn'
import type { AuthenticationResponseJSON } from '@simplewebauthn/server'

/**
 * Passkey-based MFA step-up (ADR 0016). The SSO login left the session
 * `mfa_pending`; a verified WebAuthn assertion against one of the user's
 * registered passkeys clears the gate — the passkey equivalent of
 * /api/auth/mfa/stepup's TOTP path.
 *
 * POST { action: 'begin' }              — authentication options (+ challenge)
 * POST { action: 'finish', response }   — verify assertion → clear mfa_pending
 *
 * No CSRF: completes an auth handshake before the session is usable, like login.
 */
async function _POST(req: Request) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const pending = await readMfaPendingSession()
  if (!pending) return NextResponse.json({ error: 'no_pending_mfa_session' }, { status: 401 })
  const uid = pending.userId

  const body = (await req.json().catch(() => ({}))) as {
    action?: 'begin' | 'finish'; response?: AuthenticationResponseJSON
  }

  if (body.action === 'begin') {
    const options = await beginAuthentication(pool, uid)
    if (!options.allowCredentials || options.allowCredentials.length === 0) {
      return NextResponse.json({ error: 'no_passkey_enrolled' }, { status: 400 })
    }
    return NextResponse.json({ options })
  }

  if (body.action === 'finish') {
    if (!body.response) return NextResponse.json({ error: 'response_required' }, { status: 400 })
    try {
      const { verified } = await finishAuthentication(pool, uid, body.response)
      if (!verified) return NextResponse.json({ error: 'verification_failed' }, { status: 400 })
    } catch {
      return NextResponse.json({ error: 'authentication_failed' }, { status: 400 })
    }
    await clearMfaPending(pool, pending.sessionId)
    return NextResponse.json({ ok: true, mfa_verified: true })
  }

  return NextResponse.json({ error: 'action required (begin|finish)' }, { status: 400 })
}

export const POST = tracedRoute('POST', '/api/auth/webauthn/authenticate', _POST)
