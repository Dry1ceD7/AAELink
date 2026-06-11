import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * POST /api/apps/connections — open a Socket Mode connection.
 *
 * Returns a WebSocket URL and connection ID for real-time app communication.
 */

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { app_id?: string }
  if (!body.app_id) return NextResponse.json({ error: 'app_id_required' }, { status: 400 })

  // Verify app ownership
  const { rows } = await pool.query(
    `SELECT id FROM aaelink.apps WHERE id = $1 AND (owner_id = $2 OR $2 IN (
       SELECT user_id FROM aaelink.workspace_members WHERE role IN ('owner', 'admin')
     ))`,
    [body.app_id, uid]
  )
  if (!rows[0]) return NextResponse.json({ error: 'app_not_found_or_forbidden' }, { status: 403 })

  const connectionId = randomUUID()
  const wsHost = process.env.WS_HOST || 'wss://ws.aaelink.local'
  const url = `${wsHost}/socket-mode/${connectionId}`

  // Register connection
  try {
    await pool.query(
      `INSERT INTO aaelink.app_connections (id, app_id, user_id, created_at)
       VALUES ($1, $2, $3, $4)`,
      [connectionId, body.app_id, uid, Date.now()]
    )
  } catch { /* table may not exist — best-effort */ }

  return NextResponse.json({ ok: true, url, connection_id: connectionId })
}

export const POST = tracedRoute('POST', '/api/apps/connections', _POST)
