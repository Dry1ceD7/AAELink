import { randomUUID, randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { isPlatformAdmin } from '@/lib/platformRole'
import { writeAuditLog, extractIp } from '@/lib/auditLog'
import { tracedRoute } from '@/lib/tracedRoute'

/** List webhooks for a workspace. Query param: workspace_id */
async function _GET(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()

  const url = new URL(req.url)
  const workspaceId = url.searchParams.get('workspace_id') ?? ''
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })

  // Must be workspace member to list.
  const { rows: member } = await pool.query<{ role: string }>(
    `SELECT role FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, uid]
  )
  if (!member[0]) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const { rows } = await pool.query(
    `SELECT id, workspace_id, channel_id, kind, display_name, description, is_active,
            callback_url, created_at, updated_at,
            -- Token only exposed to admins/owners
            CASE WHEN $3 THEN token ELSE '' END AS token
     FROM aaelink.webhooks
     WHERE workspace_id = $1
     ORDER BY created_at DESC`,
    [workspaceId, uid, ['owner', 'admin'].includes(member[0].role)]
  )
  return NextResponse.json({ webhooks: rows })
}

/** Create a webhook (owner/admin only). */
async function _POST(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()

  const body = (await req.json()) as {
    workspace_id?: string
    channel_id?:   string
    kind?:         string
    display_name?: string
    description?:  string
    callback_url?: string
  }

  const workspaceId   = String(body.workspace_id ?? '').trim()
  const channelId     = String(body.channel_id   ?? '').trim() || null
  const kind          = String(body.kind         ?? 'incoming').trim()
  const displayName   = String(body.display_name ?? '').trim().slice(0, 200)
  const description   = String(body.description  ?? '').trim().slice(0, 1000)
  const callbackUrl   = String(body.callback_url ?? '').trim().slice(0, 2000)

  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  if (!['incoming', 'outgoing'].includes(kind)) {
    return NextResponse.json({ error: 'invalid_kind' }, { status: 400 })
  }
  if (kind === 'outgoing' && !callbackUrl) {
    return NextResponse.json({ error: 'callback_url_required_for_outgoing' }, { status: 400 })
  }

  // Only workspace owners/admins or platform admins may create webhooks.
  const { rows: member } = await pool.query<{ role: string; platform_role: string }>(
    `SELECT wm.role, u.platform_role
     FROM aaelink.workspace_members wm
     JOIN aaelink.users u ON u.id = wm.user_id
     WHERE wm.workspace_id = $1 AND wm.user_id = $2`,
    [workspaceId, uid]
  )
  const m = member[0]
  if (!m) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!['owner', 'admin'].includes(m.role) && !isPlatformAdmin(m.platform_role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const id    = randomUUID()
  const token = randomBytes(32).toString('hex')
  const now   = Date.now()

  await pool.query(
    `INSERT INTO aaelink.webhooks
       (id, workspace_id, channel_id, created_by, kind, display_name, description,
        token, callback_url, is_active, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$10)`,
    [id, workspaceId, channelId, uid, kind, displayName, description, token, callbackUrl, now]
  )

  writeAuditLog({
    pool, workspaceId, actorId: uid, actorRole: m.role,
    action: 'webhook.create', resourceKind: 'webhook', resourceId: id,
    ipAddress: extractIp(req),
    metadata: { kind, display_name: displayName }
  })

  return NextResponse.json({ id, token, kind, display_name: displayName, created_at: now })
}

/** Delete a webhook (owner/admin only). Query param: id */
async function _DELETE(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()

  const url = new URL(req.url)
  const webhookId = url.searchParams.get('id') ?? ''
  if (!webhookId) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  const { rows } = await pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.webhooks WHERE id = $1`,
    [webhookId]
  )
  if (!rows[0]) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { rows: member } = await pool.query<{ role: string }>(
    `SELECT role FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [rows[0].workspace_id, uid]
  )
  if (!member[0] || !['owner', 'admin'].includes(member[0].role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  await pool.query(`DELETE FROM aaelink.webhooks WHERE id = $1`, [webhookId])

  writeAuditLog({
    pool, workspaceId: rows[0].workspace_id, actorId: uid, actorRole: member[0].role,
    action: 'webhook.delete', resourceKind: 'webhook', resourceId: webhookId,
    ipAddress: extractIp(req)
  })

  return NextResponse.json({ deleted: true })
}

/** Toggle webhook active state (owner/admin only). Body: { id, is_active } */
async function _PATCH(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()

  const body = (await req.json()) as { id?: string; is_active?: boolean }
  const webhookId = String(body.id ?? '').trim()
  if (!webhookId) return NextResponse.json({ error: 'id_required' }, { status: 400 })
  if (typeof body.is_active !== 'boolean') {
    return NextResponse.json({ error: 'is_active_required' }, { status: 400 })
  }

  const { rows } = await pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.webhooks WHERE id = $1`,
    [webhookId]
  )
  if (!rows[0]) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { rows: member } = await pool.query<{ role: string }>(
    `SELECT role FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [rows[0].workspace_id, uid]
  )
  if (!member[0] || !['owner', 'admin'].includes(member[0].role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  await pool.query(
    `UPDATE aaelink.webhooks SET is_active = $1, updated_at = $2 WHERE id = $3`,
    [body.is_active, Date.now(), webhookId]
  )

  writeAuditLog({
    pool, workspaceId: rows[0].workspace_id, actorId: uid, actorRole: member[0].role,
    action: body.is_active ? 'webhook.enable' : 'webhook.disable',
    resourceKind: 'webhook', resourceId: webhookId,
    ipAddress: extractIp(req)
  })

  return NextResponse.json({ id: webhookId, is_active: body.is_active })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/webhooks', _GET)
export const POST   = tracedRoute('POST', '/api/webhooks', _POST)
export const PATCH  = tracedRoute('PATCH', '/api/webhooks', _PATCH)
export const DELETE = tracedRoute('DELETE', '/api/webhooks', _DELETE)
