import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { shareChannelToWorkspace, unshareChannelFromWorkspace } from '@/lib/channels/sharedWorkspaceChannels'

const SHARE_ERROR_STATUS: Record<string, number> = {
  not_found: 404,
  forbidden: 403,
  not_public: 409,
  no_org: 409,
  target_not_found: 404,
  cross_org: 409,
  same_workspace: 409,
  already_shared: 409,
  not_shared: 404,
}

/** POST /api/channels/:id/shared-workspaces — home-workspace owner shares into a sibling workspace (D1). Body: { workspace_id }. */
async function _POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf

  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()
  const { id: channelId } = await ctx.params

  const body = (await req.json().catch(() => ({}))) as { workspace_id?: string }
  const workspaceId = String(body.workspace_id || '').trim()
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })

  const result = await shareChannelToWorkspace(pool, uid, channelId, workspaceId)
  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: SHARE_ERROR_STATUS[result.code] ?? 400 })
  }

  writeAuditLog({
    pool,
    actorId: uid,
    action: 'channel.shared_workspace.add',
    resourceKind: 'channel',
    resourceId: result.channelId,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
    metadata: { workspace_id: result.workspaceId },
  })

  return NextResponse.json({ ok: true, channel_id: result.channelId, workspace_id: result.workspaceId })
}

/** DELETE /api/channels/:id/shared-workspaces — owner removes a share (D1). Body: { workspace_id }. */
async function _DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf

  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()
  const { id: channelId } = await ctx.params

  const body = (await req.json().catch(() => ({}))) as { workspace_id?: string }
  const workspaceId = String(body.workspace_id || '').trim()
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })

  const result = await unshareChannelFromWorkspace(pool, uid, channelId, workspaceId)
  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: SHARE_ERROR_STATUS[result.code] ?? 400 })
  }

  writeAuditLog({
    pool,
    actorId: uid,
    action: 'channel.shared_workspace.remove',
    resourceKind: 'channel',
    resourceId: result.channelId,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
    metadata: { workspace_id: result.workspaceId },
  })

  return NextResponse.json({ ok: true, channel_id: result.channelId, workspace_id: result.workspaceId })
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/channels/:id/shared-workspaces', _POST)
export const DELETE = tracedRoute('DELETE', '/api/channels/:id/shared-workspaces', _DELETE)
