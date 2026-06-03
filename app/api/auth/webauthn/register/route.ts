import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import {
  beginRegistration, finishRegistration, listCredentials, deleteCredential,
} from '@/lib/auth/webauthn'
import type { RegistrationResponseJSON } from '@simplewebauthn/server'

/**
 * Passkey (WebAuthn) enrolment for the signed-in user (ADR 0016).
 *
 * GET    — list the user's registered passkeys
 * POST   { action: 'begin' }            — registration options (+ stores challenge)
 * POST   { action: 'finish', response, name } — verify + persist the credential
 * DELETE ?id=<credential row id>        — remove a passkey
 *
 * Requires a fully-authenticated session (readSessionUserId rejects an
 * mfa_pending SSO session), so a passkey can only be added after sign-in.
 */
async function _GET() {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json({ passkeys: await listCredentials(pool, uid) })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    action?: 'begin' | 'finish'; response?: RegistrationResponseJSON; name?: string
  }

  if (body.action === 'begin') {
    const { rows: [u] } = await pool.query<{ username: string; email: string }>(
      `SELECT username, email FROM aaelink.users WHERE id = $1`, [uid]
    )
    const options = await beginRegistration(pool, uid, u?.username || u?.email || uid)
    return NextResponse.json({ options })
  }

  if (body.action === 'finish') {
    if (!body.response) return NextResponse.json({ error: 'response_required' }, { status: 400 })
    try {
      const { verified } = await finishRegistration(pool, uid, body.response, body.name || '')
      if (!verified) return NextResponse.json({ error: 'verification_failed' }, { status: 400 })
      return NextResponse.json({ ok: true, verified: true }, { status: 201 })
    } catch {
      return NextResponse.json({ error: 'registration_failed' }, { status: 400 })
    }
  }

  return NextResponse.json({ error: 'action required (begin|finish)' }, { status: 400 })
}

async function _DELETE(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id')?.trim() || ''
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })
  const removed = await deleteCredential(pool, uid, id)
  if (!removed) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

export const GET    = tracedRoute('GET', '/api/auth/webauthn/register', _GET)
export const POST   = tracedRoute('POST', '/api/auth/webauthn/register', _POST)
export const DELETE = tracedRoute('DELETE', '/api/auth/webauthn/register', _DELETE)
