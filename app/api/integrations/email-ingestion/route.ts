// keep: external integration entry point (webhook / IdP / push provider / device)
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID, randomBytes } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Email Ingestion API — email-to-channel routing.
 *
 * GET  /api/integrations/email-ingestion — list configured email routes
 * POST /api/integrations/email-ingestion — create a new email route
 *
 * Each route maps an inbound email address to a channel.
 * When emails arrive at the address, they are posted as messages
 * with sender info, subject as thread topic, and attachments preserved.
 *
 * Used for:
 *   - Support email → #support channel
 *   - Alert email → #ops-alerts channel
 *   - Customer feedback → #feedback channel
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const wsId = req.nextUrl.searchParams.get('workspace_id') || ''

  let where = ''
  const params: string[] = []
  if (wsId) { params.push(wsId); where = `WHERE r.workspace_id = $${params.length}` }

  const { rows } = await pool.query(`
    SELECT r.*, c.name AS channel_name, c.slug AS channel_slug
    FROM aaelink.email_routes r
    LEFT JOIN aaelink.channels c ON c.id = r.channel_id
    ${where}
    ORDER BY r.created_at DESC
  `, params)

  return NextResponse.json({
    routes: rows.map(r => ({
      ...r,
      created_at: Number(r.created_at),
      last_received_at: Number(r.last_received_at || 0),
    })),
    total: rows.length,
  })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    workspace_id?: string; channel_id?: string; label?: string
    allowed_senders?: string[]; strip_signatures?: boolean
    create_threads?: boolean
  }

  const wsId = String(body.workspace_id || '').trim()
  const channelId = String(body.channel_id || '').trim()
  if (!wsId || !channelId) {
    return NextResponse.json({ error: 'workspace_id_and_channel_id_required' }, { status: 400 })
  }

  // Verify channel exists
  const { rows: chRows } = await pool.query(
    `SELECT id FROM aaelink.channels WHERE id = $1 AND workspace_id = $2`, [channelId, wsId]
  )
  if (!chRows[0]) return NextResponse.json({ error: 'channel_not_found' }, { status: 404 })

  const id = randomUUID()
  const now = Date.now()
  const inboundAddress = `ch-${randomBytes(6).toString('hex')}@inbound.aaelink.local`

  await pool.query(`
    INSERT INTO aaelink.email_routes
      (id, workspace_id, channel_id, inbound_address, label, status,
       allowed_senders, strip_signatures, create_threads,
       messages_received, last_received_at, created_by, created_at)
    VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8, 0, 0, $9, $10)
  `, [
    id, wsId, channelId, inboundAddress,
    body.label || 'Email Route', JSON.stringify(body.allowed_senders || []),
    body.strip_signatures !== false, body.create_threads !== false,
    uid, now
  ])

  return NextResponse.json({
    route: {
      id, inbound_address: inboundAddress, channel_id: channelId,
      status: 'active', created_at: now,
    }
  }, { status: 201 })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/integrations/email-ingestion', _GET)
export const POST   = tracedRoute('POST', '/api/integrations/email-ingestion', _POST)
