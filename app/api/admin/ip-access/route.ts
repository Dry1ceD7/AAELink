// keep: enterprise admin surface kept for parity (intentional, not yet wired into UI)
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { IpAccessController, type IpAccessConfig } from '@/lib/auth/ipAccess'

/**
 * Admin IP Access Control API
 *
 * GET  /api/admin/ip-access — get current IP access config
 * POST /api/admin/ip-access — update config or test an IP
 *   Actions: update, test, add_allow, remove_allow, add_deny, remove_deny
 */

// Singleton controller (survives across requests in same process)
let controller: IpAccessController | null = null
function getController(): IpAccessController {
  if (!controller) controller = new IpAccessController()
  return controller
}

async function _GET(req: NextRequest) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'admin_required' }, { status: 403 })
  }

  const ctrl = getController()

  return NextResponse.json({ config: ctrl.getConfig() })
}

async function _POST(req: NextRequest) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'admin_required' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: string
    ip?: string
    cidr?: string
    path?: string
    config?: Record<string, unknown>
  }

  const ctrl = getController()

  if (body.action === 'test') {
    const ip = body.ip || '127.0.0.1'
    const path = body.path || '/'
    const result = ctrl.check(ip, path)
    return NextResponse.json({ ip, path, result })
  }

  if (body.action === 'update' && body.config) {
    ctrl.updateConfig(body.config as Partial<IpAccessConfig>)
    return NextResponse.json({ ok: true, config: ctrl.getConfig() })
  }

  if (body.action === 'add_allow' && body.cidr) {
    ctrl.addToAllowlist(body.cidr)
    return NextResponse.json({ ok: true, allowlist: ctrl.getConfig().allowlist })
  }

  if (body.action === 'remove_allow' && body.cidr) {
    ctrl.removeFromAllowlist(body.cidr)
    return NextResponse.json({ ok: true, allowlist: ctrl.getConfig().allowlist })
  }

  if (body.action === 'add_deny' && body.cidr) {
    ctrl.addToDenylist(body.cidr)
    return NextResponse.json({ ok: true, denylist: ctrl.getConfig().denylist })
  }

  if (body.action === 'remove_deny' && body.cidr) {
    ctrl.removeFromDenylist(body.cidr)
    return NextResponse.json({ ok: true, denylist: ctrl.getConfig().denylist })
  }

  return NextResponse.json({
    error: 'unknown_action',
    valid_actions: ['test', 'update', 'add_allow', 'remove_allow', 'add_deny', 'remove_deny']
  }, { status: 400 })
}

export const GET  = tracedRoute('GET',  '/api/admin/ip-access', _GET)
export const POST = tracedRoute('POST', '/api/admin/ip-access', _POST)
