import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { getWipeSignal, acknowledgeWipe } from '@/lib/enterprise/deviceManagement'

/**
 * Device wipe signaling (D2) — the client side of remote wipe.
 *
 * GET  /api/devices/wipe-status?device_id=... — the owner polls for a pending wipe
 * POST /api/devices/wipe-status — the owner acknowledges a completed wipe
 *
 * A caller may only read/ack a device they own (device.user_id === session uid).
 */

/** Confirm the device exists and belongs to the caller. Returns 404/403 response or null. */
async function assertOwner(
  pool: NonNullable<ReturnType<typeof getPool>>,
  deviceId: string,
  uid: string
): Promise<NextResponse | null> {
  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM aaelink.devices WHERE id = $1`, [deviceId]
  )
  if (!rows[0]) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (rows[0].user_id !== uid) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  return null
}

async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const deviceId = (req.nextUrl.searchParams.get('device_id') || '').trim()
  if (!deviceId) return NextResponse.json({ error: 'device_id_required' }, { status: 400 })

  const denied = await assertOwner(pool, deviceId, uid)
  if (denied) return denied

  const signal = await getWipeSignal(pool, deviceId)
  return NextResponse.json({ signal })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { device_id?: string }
  const deviceId = String(body.device_id || '').trim()
  if (!deviceId) return NextResponse.json({ error: 'device_id_required' }, { status: 400 })

  const denied = await assertOwner(pool, deviceId, uid)
  if (denied) return denied

  const result = await acknowledgeWipe(pool, deviceId)
  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: result.code === 'not_found' ? 404 : 409 })
  }
  return NextResponse.json({ ok: true, device_id: result.deviceId })
}

export const GET  = tracedRoute('GET', '/api/devices/wipe-status', _GET)
export const POST = tracedRoute('POST', '/api/devices/wipe-status', _POST)
