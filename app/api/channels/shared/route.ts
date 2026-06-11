import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Shared Channels (Cross-Organization Federation) API.
 *
 * GET  /api/channels/shared — list shared channel links
 * POST /api/channels/shared — create or accept a shared channel invitation
 *
 * Federation model:
 *   - Origin org creates a share invitation for a channel
 *   - Remote org accepts and links their local channel
 *   - Messages are synced bidirectionally via federation protocol
 *   - Each org retains compliance/retention independence
 *
 * Invitation states: pending → accepted → active → revoked
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
  const status = req.nextUrl.searchParams.get('status') || ''

  let where = 'WHERE 1=1'
  const params: string[] = []
  if (wsId) { params.push(wsId); where += ` AND sc.workspace_id = $${params.length}` }
  if (['pending', 'accepted', 'active', 'revoked'].includes(status)) {
    params.push(status); where += ` AND sc.status = $${params.length}`
  }

  const { rows } = await pool.query(`
    SELECT sc.*, c.name AS channel_name, u.username AS created_by_username
    FROM aaelink.shared_channels sc
    LEFT JOIN aaelink.channels c ON c.id = sc.channel_id
    LEFT JOIN aaelink.users u ON u.id = sc.created_by
    ${where}
    ORDER BY sc.created_at DESC
    LIMIT 100
  `, params)

  return NextResponse.json({
    shared_channels: rows.map(s => ({ ...s, created_at: Number(s.created_at), accepted_at: Number(s.accepted_at || 0) })),
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
    action?: 'create_invite' | 'accept_invite' | 'revoke'
    channel_id?: string; workspace_id?: string
    remote_org_name?: string; remote_org_url?: string
    invitation_id?: string
    sync_mode?: string // 'bidirectional' | 'read_only'
    share_history?: boolean
  }

  if (body.action === 'create_invite') {
    const channelId = String(body.channel_id || '').trim()
    if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })

    const id = randomUUID()
    const inviteToken = `share_${randomUUID().replace(/-/g, '')}`
    const now = Date.now()

    await pool.query(`
      INSERT INTO aaelink.shared_channels
        (id, channel_id, workspace_id, direction, remote_org_name, remote_org_url,
         invite_token, sync_mode, share_history, status, created_by, created_at, accepted_at)
      VALUES ($1, $2, $3, 'outbound', $4, $5, $6, $7, $8, 'pending', $9, $10, 0)
    `, [
      id, channelId, body.workspace_id || '',
      body.remote_org_name || '', body.remote_org_url || '',
      inviteToken, body.sync_mode || 'bidirectional',
      body.share_history !== false, uid, now
    ])

    return NextResponse.json({
      invitation: { id, invite_token: inviteToken, status: 'pending', created_at: now },
      instructions: 'Share the invite_token with the remote organization to complete the federation link.'
    }, { status: 201 })
  }

  if (body.action === 'accept_invite') {
    const invId = String(body.invitation_id || '').trim()
    if (!invId) return NextResponse.json({ error: 'invitation_id_required' }, { status: 400 })

    const now = Date.now()
    const { rowCount } = await pool.query(
      `UPDATE aaelink.shared_channels SET status = 'active', accepted_at = $1 WHERE id = $2 AND status = 'pending'`,
      [now, invId]
    )
    if (!rowCount) return NextResponse.json({ error: 'invitation_not_found_or_already_accepted' }, { status: 404 })

    return NextResponse.json({ ok: true, status: 'active', accepted_at: now })
  }

  if (body.action === 'revoke') {
    const invId = String(body.invitation_id || '').trim()
    if (!invId) return NextResponse.json({ error: 'invitation_id_required' }, { status: 400 })

    const { rowCount } = await pool.query(
      `UPDATE aaelink.shared_channels SET status = 'revoked' WHERE id = $1`,
      [invId]
    )
    if (!rowCount) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    return NextResponse.json({ ok: true, status: 'revoked' })
  }

  return NextResponse.json({ error: 'action_required (create_invite|accept_invite|revoke)' }, { status: 400 })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/channels/shared', _GET)
export const POST   = tracedRoute('POST', '/api/channels/shared', _POST)
