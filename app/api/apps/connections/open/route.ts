import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { openSocketConnection } from '@/lib/apps/socketMode'

/**
 * POST /api/apps/connections/open (D7) — socket mode.
 *
 * The app authenticates with its bot token (Authorization: Bearer xoxb-...) and
 * receives a short-lived WSS URL + ticket to connect for event delivery. No
 * cookie/session — this is an app-to-server call.
 */

/** Gateway origin for socket-mode WSS URLs. */
function wssBase(): string {
  const explicit = process.env.AAELINK_WSS_URL?.trim()
  if (explicit) return explicit
  const app = process.env.NEXT_PUBLIC_APP_URL?.trim() || 'http://localhost:3040'
  return app.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })

  const auth = req.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token) return NextResponse.json({ error: 'app_token_required' }, { status: 401 })

  const result = await openSocketConnection(pool, token, wssBase())
  if (!result.ok) {
    const status = result.code === 'invalid_app_token' ? 401 : 403
    return NextResponse.json({ error: result.code }, { status })
  }

  return NextResponse.json({
    ok: true,
    url: result.url,
    ticket: result.ticket,
    expires_at: result.expires_at,
  })
}

export const POST = tracedRoute('POST', '/api/apps/connections/open', _POST)
