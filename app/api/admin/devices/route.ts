import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Device Management API — track and manage user devices / sessions.
 *
 * GET    /api/admin/devices — admin: list all devices across users
 * GET    /api/admin/devices?user_id=... — admin: devices for a specific user
 * POST   /api/admin/devices — user: register a new device
 * DELETE /api/admin/devices?device_id=... — admin: remote wipe / revoke a device
 *
 * Device records:
 *   - Track device type (desktop/mobile/web/tablet)
 *   - OS and browser info
 *   - Last active timestamp + IP address
 *   - Trust status (trusted/untrusted/blocked)
 *   - Remote wipe capability (marks sessions invalid, forces re-auth)
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const userId = req.nextUrl.searchParams.get('user_id') || ''
  const myDevices = req.nextUrl.searchParams.get('mine') === 'true'

  // Non-admin users can only see their own devices
  if (!myDevices) {
    const { rows: uRows } = await pool.query<{ platform_role: string }>(
      `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
    )
    if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  }

  const targetUser = myDevices ? uid : userId
  let where = ''
  const params: string[] = []
  if (targetUser) {
    params.push(targetUser); where = `WHERE d.user_id = $${params.length}`
  }

  const { rows } = await pool.query(`
    SELECT d.*, u.username, u.email
    FROM aaelink.devices d
    LEFT JOIN aaelink.users u ON u.id = d.user_id
    ${where}
    ORDER BY d.last_active_at DESC
    LIMIT 200
  `, params)

  // Summary
  const { rows: [summary] } = await pool.query<{
    total: string; desktop: string; mobile: string; web: string
    trusted: string; blocked: string
  }>(`
    SELECT
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE device_type = 'desktop')::text AS desktop,
      COUNT(*) FILTER (WHERE device_type = 'mobile')::text AS mobile,
      COUNT(*) FILTER (WHERE device_type = 'web')::text AS web,
      COUNT(*) FILTER (WHERE trust_status = 'trusted')::text AS trusted,
      COUNT(*) FILTER (WHERE trust_status = 'blocked')::text AS blocked
    FROM aaelink.devices
    ${targetUser ? `WHERE user_id = $1` : ''}
  `, targetUser ? [targetUser] : [])

  return NextResponse.json({
    devices: rows.map(d => ({
      ...d,
      registered_at: Number(d.registered_at),
      last_active_at: Number(d.last_active_at || 0),
    })),
    summary: {
      total: Number(summary.total),
      desktop: Number(summary.desktop),
      mobile: Number(summary.mobile),
      web: Number(summary.web),
      trusted: Number(summary.trusted),
      blocked: Number(summary.blocked),
    }
  })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    device_type?: string; device_name?: string
    os?: string; browser?: string; ip_address?: string
    push_token?: string
  }

  const deviceType = ['desktop', 'mobile', 'web', 'tablet'].includes(body.device_type || '')
    ? body.device_type! : 'web'

  const id = randomUUID()
  const now = Date.now()

  await pool.query(`
    INSERT INTO aaelink.devices
      (id, user_id, device_type, device_name, os, browser,
       ip_address, push_token, trust_status, registered_at, last_active_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'untrusted', $9, $9)
  `, [
    id, uid, deviceType, body.device_name || 'Unknown Device',
    body.os || '', body.browser || '', body.ip_address || '',
    body.push_token || '', now
  ])

  return NextResponse.json({
    device: { id, device_type: deviceType, trust_status: 'untrusted', registered_at: now }
  }, { status: 201 })
}

async function _PATCH(req: NextRequest) {
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
    device_id?: string; trust_status?: string
  }

  const deviceId = String(body.device_id || '').trim()
  if (!deviceId) return NextResponse.json({ error: 'device_id_required' }, { status: 400 })

  const status = ['trusted', 'untrusted', 'blocked'].includes(body.trust_status || '')
    ? body.trust_status! : ''
  if (!status) return NextResponse.json({ error: 'valid trust_status required (trusted|untrusted|blocked)' }, { status: 400 })

  const { rowCount } = await pool.query(
    `UPDATE aaelink.devices SET trust_status = $1 WHERE id = $2`, [status, deviceId]
  )
  if (!rowCount) return NextResponse.json({ error: 'device_not_found' }, { status: 404 })

  return NextResponse.json({ ok: true, device_id: deviceId, trust_status: status })
}

async function _DELETE(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const deviceId = req.nextUrl.searchParams.get('device_id')?.trim() || ''
  if (!deviceId) return NextResponse.json({ error: 'device_id_required' }, { status: 400 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  const isAdmin = ['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')

  // Admin can wipe any device; users can only remove their own
  const condition = isAdmin ? 'id = $1' : 'id = $1 AND user_id = $2'
  const params = isAdmin ? [deviceId] : [deviceId, uid]

  const { rowCount } = await pool.query(
    `DELETE FROM aaelink.devices WHERE ${condition}`, params
  )
  if (!rowCount) return NextResponse.json({ error: 'device_not_found' }, { status: 404 })

  // Invalidate sessions for this device (remote wipe)
  await pool.query(
    `DELETE FROM aaelink.sessions WHERE device_id = $1`, [deviceId]
  )

  // Audit
  await pool.query(`
    INSERT INTO aaelink.audit_log (id, actor_id, action, target_type, target_id, created_at)
    VALUES ($1, $2, 'device_wiped', 'device', $3, $4)
  `, [randomUUID(), uid, deviceId, Date.now()])

  return NextResponse.json({ ok: true, wiped: deviceId })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/admin/devices', _GET)
export const POST   = tracedRoute('POST', '/api/admin/devices', _POST)
export const PATCH  = tracedRoute('PATCH', '/api/admin/devices', _PATCH)
export const DELETE = tracedRoute('DELETE', '/api/admin/devices', _DELETE)
