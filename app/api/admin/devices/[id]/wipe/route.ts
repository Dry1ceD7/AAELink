import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { requestRemoteWipe } from '@/lib/enterprise/deviceManagement'

/**
 * POST /api/admin/devices/[id]/wipe (D2) — admin requests a remote wipe of a
 * device. Stamps the wipe signal and revokes the device's sessions; the client
 * completes the wipe and acknowledges via /api/devices/wipe-status.
 */
type Ctx = { params: Promise<{ id: string }> }

async function _POST(_req: NextRequest, ctx: Ctx) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows } = await pool.query(`SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid])
  if (!isPlatformAdmin((rows[0] as { platform_role?: string })?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { id: deviceId } = await ctx.params
  const result = await requestRemoteWipe(pool, deviceId, uid)
  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: result.code === 'not_found' ? 404 : 400 })
  }
  return NextResponse.json({ ok: true, device_id: result.deviceId, sessions_revoked: result.sessionsRevoked })
}

export const POST = tracedRoute('POST', '/api/admin/devices/[id]/wipe', _POST)
