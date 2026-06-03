import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { listSharedWorkspaceChannels, joinSharedWorkspaceChannel } from '@/lib/channels/sharedWorkspaceChannels'

/** GET /api/channels/shared-workspaces — list channels shared into the user's workspaces (D1). */
async function _GET() {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()

  const channels = await listSharedWorkspaceChannels(pool, uid)
  return NextResponse.json({ channels, total: channels.length })
}

const JOIN_ERROR_STATUS: Record<string, number> = {
  not_found: 404,
  not_shared_to_user: 403,
  already_member: 409,
}

/** POST /api/channels/shared-workspaces — join a multi-workspace shared channel (D1). Body: { channel_id }. */
async function _POST(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf

  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()

  const body = (await req.json().catch(() => ({}))) as { channel_id?: string }
  const channelId = String(body.channel_id || '').trim()
  if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })

  const result = await joinSharedWorkspaceChannel(pool, uid, channelId)
  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: JOIN_ERROR_STATUS[result.code] ?? 400 })
  }

  writeAuditLog({
    pool,
    actorId: uid,
    action: 'channel.shared_workspace.join',
    resourceKind: 'channel',
    resourceId: result.channelId,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
  })

  return NextResponse.json({ ok: true, channel_id: result.channelId })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET  = tracedRoute('GET', '/api/channels/shared-workspaces', _GET)
export const POST = tracedRoute('POST', '/api/channels/shared-workspaces', _POST)
