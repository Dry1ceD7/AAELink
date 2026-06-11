import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { randomUUID, randomBytes } from 'crypto'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { verifyCsrf } from '@/lib/auth/csrf'

/** Resolve the caller's workspace role, or '' if not a member. */
async function workspaceRole(
  pool: import('pg').Pool,
  workspaceId: string,
  userId: string
): Promise<string> {
  const { rows } = await pool.query<{ role: string }>(
    `SELECT role FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, userId]
  )
  return rows[0]?.role || ''
}

/** Best-effort domain audit row — must never fail the request (Hard Rule #5). */
async function auditWebhook(
  pool: import('pg').Pool,
  opts: { workspaceId: string; actorId: string; action: string; resourceId: string; metadata: Record<string, unknown> }
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO aaelink.audit_log (id, workspace_id, actor_id, action, resource_id, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), opts.workspaceId, opts.actorId, opts.action, opts.resourceId, JSON.stringify(opts.metadata), Date.now()]
    )
  } catch { /* audit log is best-effort */ }
}

async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const workspaceId = searchParams.get('workspace_id')?.trim() || ''

  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  }

  // Membership required — never list another workspace's webhooks.
  if (!(await workspaceRole(pool, workspaceId, userId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  try {
    // Never expose secret_token in the list (it is returned once on create).
    const { rows: webhooks } = await pool.query(
      `SELECT w.id, w.workspace_id, w.app_id, w.channel_id, w.name, w.created_by, w.created_at,
              c.name as channel_name, a.name as app_name
       FROM aaelink.incoming_webhooks w
       JOIN aaelink.channels c ON w.channel_id = c.id
       LEFT JOIN aaelink.apps a ON w.app_id = a.id
       WHERE w.workspace_id = $1
       ORDER BY w.created_at DESC`,
      [workspaceId]
    )
    return NextResponse.json({ webhooks })
  } catch {
    return NextResponse.json({ error: 'webhook_query_failed' }, { status: 503 })
  }
}

async function _POST(req: NextRequest) {
  const csrfErr = await verifyCsrf(req)
  if (csrfErr) return csrfErr
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    workspace_id?: string
    app_id?: string
    channel_id?: string
    name?: string
  }
  const workspaceId = String(body.workspace_id || '').trim()
  const channelId = String(body.channel_id || '').trim()
  const name = String(body.name || '').trim()
  const appId = String(body.app_id || '').trim()

  if (!workspaceId || !channelId || !name) {
    return NextResponse.json({ error: 'missing_required_fields' }, { status: 400 })
  }

  // RBAC: only an owner/admin of the TARGET workspace may create a webhook on it.
  // Without this any authenticated user could mint a posting credential against
  // any workspace's channels.
  const role = await workspaceRole(pool, workspaceId, userId)
  if (!['owner', 'admin'].includes(role)) {
    return NextResponse.json({ error: 'forbidden_admin_only' }, { status: 403 })
  }

  const id = randomUUID()
  // Generate a secure secret token for the webhook URL
  const secret_token = randomBytes(24).toString('hex')

  try {
    await pool.query(
      `INSERT INTO aaelink.incoming_webhooks
       (id, workspace_id, app_id, channel_id, name, secret_token, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, workspaceId, appId || null, channelId, name, secret_token, userId, Date.now()]
    )
  } catch {
    return NextResponse.json({ error: 'webhook_create_failed' }, { status: 503 })
  }

  await auditWebhook(pool, {
    workspaceId,
    actorId: userId,
    action: 'incoming_webhook.create',
    resourceId: id,
    metadata: { name, channel_id: channelId, app_id: appId || null },
  })

  return NextResponse.json({ success: true, id, secret_token })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/integrations/webhooks', _GET)
export const POST   = tracedRoute('POST', '/api/integrations/webhooks', _POST)
