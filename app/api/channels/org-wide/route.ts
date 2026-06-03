import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { listOrgWideChannels, joinOrgWideChannel } from '@/lib/channels/orgWideChannels'

/** GET /api/channels/org-wide — list org-wide channels in the user's org(s) (D1). */
async function _GET() {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()

  const channels = await listOrgWideChannels(pool, uid)
  return NextResponse.json({ channels, total: channels.length })
}

const JOIN_ERROR_STATUS: Record<string, number> = {
  not_found: 404,
  not_org_wide: 403,
  not_in_org: 403,
  already_member: 409,
}

/** POST /api/channels/org-wide — join an org-wide channel (D1). Body: { channel_id }. */
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

  const result = await joinOrgWideChannel(pool, uid, channelId)
  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: JOIN_ERROR_STATUS[result.code] ?? 400 })
  }

  writeAuditLog({
    pool,
    actorId: uid,
    action: 'channel.org_wide.join',
    resourceKind: 'channel',
    resourceId: result.channelId,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
  })

  return NextResponse.json({ ok: true, channel_id: result.channelId })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET  = tracedRoute('GET', '/api/channels/org-wide', _GET)
export const POST = tracedRoute('POST', '/api/channels/org-wide', _POST)
