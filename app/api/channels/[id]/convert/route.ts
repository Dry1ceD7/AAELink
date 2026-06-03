import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { convertChannelType } from '@/lib/channels/channelConversion'

const CONVERT_ERROR_STATUS: Record<string, number> = {
  not_found: 404,
  forbidden: 403,
  invalid_type: 400,
  same_type: 409,
  cannot_convert_dm: 409,
  org_wide_conflict: 409,
  shared_conflict: 409,
}

/** POST /api/channels/:id/convert — convert a channel public<->private (D3). Body: { type: 'O' | 'P' }. */
async function _POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf

  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()
  const { id: channelId } = await ctx.params

  const body = (await req.json().catch(() => ({}))) as { type?: string }
  const targetType = String(body.type || '').trim()

  const result = await convertChannelType(pool, uid, channelId, targetType)
  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: CONVERT_ERROR_STATUS[result.code] ?? 400 })
  }

  writeAuditLog({
    pool,
    actorId: uid,
    action: 'channel.convert',
    resourceKind: 'channel',
    resourceId: result.channelId,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
    metadata: { type: result.type },
  })

  return NextResponse.json({ ok: true, channel_id: result.channelId, type: result.type })
}

// ── Traced export ───────────────────────────────────────────────────
export const POST = tracedRoute('POST', '/api/channels/:id/convert', _POST)
