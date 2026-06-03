import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { promoteChannelToOrgWide, demoteOrgWideChannel } from '@/lib/channels/orgWideChannels'

const ORG_WIDE_ERROR_STATUS: Record<string, number> = {
  not_found: 404,
  forbidden: 403,
  not_public: 409,
  no_org: 409,
  already_org_wide: 409,
  not_org_wide: 409,
}

/** POST /api/channels/:id/org-wide — home-workspace owner promotes to org-wide (D1). */
async function _POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf

  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()
  const { id: channelId } = await ctx.params

  const result = await promoteChannelToOrgWide(pool, uid, channelId)
  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: ORG_WIDE_ERROR_STATUS[result.code] ?? 400 })
  }

  writeAuditLog({
    pool,
    actorId: uid,
    action: 'channel.org_wide.promote',
    resourceKind: 'channel',
    resourceId: result.channelId,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
    metadata: { org_id: result.orgId },
  })

  return NextResponse.json({ ok: true, channel_id: result.channelId, org_id: result.orgId })
}

/** DELETE /api/channels/:id/org-wide — owner demotes back to workspace scope (D1). */
async function _DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf

  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()
  const { id: channelId } = await ctx.params

  const result = await demoteOrgWideChannel(pool, uid, channelId)
  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: ORG_WIDE_ERROR_STATUS[result.code] ?? 400 })
  }

  writeAuditLog({
    pool,
    actorId: uid,
    action: 'channel.org_wide.demote',
    resourceKind: 'channel',
    resourceId: result.channelId,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
  })

  return NextResponse.json({ ok: true, channel_id: result.channelId })
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/channels/:id/org-wide', _POST)
export const DELETE = tracedRoute('DELETE', '/api/channels/:id/org-wide', _DELETE)
