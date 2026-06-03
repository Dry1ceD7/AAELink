import { NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { iceServersFor } from '@/lib/calls/turnCredentials'

/**
 * GET /api/calls/ice — ephemeral ICE servers for the signed-in user.
 *
 * Returns the RTCPeerConnection `iceServers` list (STUN always; TURN with fresh
 * coturn HMAC credentials when TURN_STATIC_AUTH_SECRET is set). The client
 * fetches this just before establishing a peer connection; the TURN credential
 * is short-lived (TURN_CRED_TTL_SEC).
 */
async function _GET() {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { iceServers, turn, expiresAt } = iceServersFor(uid)
  return NextResponse.json({ ice_servers: iceServers, turn_configured: turn, expires_at: expiresAt })
}

export const GET = tracedRoute('GET', '/api/calls/ice', _GET)
