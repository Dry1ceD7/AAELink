// keep: enterprise admin surface kept for parity (intentional, not yet wired into UI)
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { tracedRoute } from '@/lib/api/tracedRoute'
import {
  IpAccessController,
  DEFAULT_IP_CONFIG,
  type IpAccessConfig,
} from '@/lib/auth/ipAccess'
import {
  IP_ACCESS_CONFIG_KEY,
  invalidateIpAccessCache,
} from '@/lib/auth/ipAccessGate'

/**
 * Admin IP Access Control API (Admin parity §31)
 *
 * GET  /api/admin/ip-access — get current IP access config
 * POST /api/admin/ip-access — update config or test an IP
 *   Actions: update, test, add_allow, remove_allow, add_deny, remove_deny
 *
 * Config is persisted in system_config (key ip_access_config) so that the
 * enforcement gate (lib/auth/ipAccessGate.enforceIpAllowlist, wired into
 * tracedRoute) reads the SAME source across replicas. The previous in-memory
 * singleton was per-process and unenforceable.
 */
import type { Pool } from 'pg'

async function loadConfig(pool: Pool): Promise<IpAccessConfig> {
  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = $1`, [IP_ACCESS_CONFIG_KEY]
  )
  if (rows[0]?.value) {
    try { return { ...DEFAULT_IP_CONFIG, ...JSON.parse(rows[0].value) } } catch { /**/ }
  }
  return { ...DEFAULT_IP_CONFIG }
}

async function saveConfig(pool: Pool, config: IpAccessConfig, actorId: string): Promise<void> {
  const now = Date.now()
  await pool.query(`
    INSERT INTO aaelink.system_config (key, value, updated_at)
    VALUES ($1, $2, $3)
    ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3
  `, [IP_ACCESS_CONFIG_KEY, JSON.stringify(config), now])
  invalidateIpAccessCache()
  // Best-effort audit (compliance scope: network access policy change).
  try {
    await pool.query(`
      INSERT INTO aaelink.audit_log (id, actor_id, action, resource_kind, resource_id, metadata, created_at)
      VALUES ($1, $2, 'ip_access.update', 'system', 'ip_access_config', $3, $4)
    `, [randomUUID(), actorId, JSON.stringify({
      allowlistEnabled: config.allowlistEnabled,
      denylistEnabled: config.denylistEnabled,
      allowlist_count: config.allowlist.length,
      denylist_count: config.denylist.length,
    }), now])
  } catch { /* audit failures must never break the request path */ }
}

async function requireAdmin(): Promise<{ pool: Pool; uid: string } | NextResponse> {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { rows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!isPlatformAdmin(rows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  return { pool, uid }
}

async function _GET(_req: NextRequest) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate
  return NextResponse.json({ config: await loadConfig(gate.pool) })
}

async function _POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate
  const { pool, uid } = gate

  const body = (await req.json().catch(() => ({}))) as {
    action?: string; ip?: string; cidr?: string; path?: string
    config?: Record<string, unknown>
  }

  const config = await loadConfig(pool)
  const ctrl = new IpAccessController(config)

  if (body.action === 'test') {
    const ip = body.ip || '127.0.0.1'
    const path = body.path || '/'
    return NextResponse.json({ ip, path, result: ctrl.check(ip, path) })
  }

  if (body.action === 'update' && body.config) {
    ctrl.updateConfig(body.config as Partial<IpAccessConfig>)
    await saveConfig(pool, ctrl.getConfig(), uid)
    return NextResponse.json({ ok: true, config: ctrl.getConfig() })
  }

  if (body.action === 'add_allow' && body.cidr) {
    ctrl.addToAllowlist(body.cidr)
    await saveConfig(pool, ctrl.getConfig(), uid)
    return NextResponse.json({ ok: true, allowlist: ctrl.getConfig().allowlist })
  }

  if (body.action === 'remove_allow' && body.cidr) {
    ctrl.removeFromAllowlist(body.cidr)
    await saveConfig(pool, ctrl.getConfig(), uid)
    return NextResponse.json({ ok: true, allowlist: ctrl.getConfig().allowlist })
  }

  if (body.action === 'add_deny' && body.cidr) {
    ctrl.addToDenylist(body.cidr)
    await saveConfig(pool, ctrl.getConfig(), uid)
    return NextResponse.json({ ok: true, denylist: ctrl.getConfig().denylist })
  }

  if (body.action === 'remove_deny' && body.cidr) {
    ctrl.removeFromDenylist(body.cidr)
    await saveConfig(pool, ctrl.getConfig(), uid)
    return NextResponse.json({ ok: true, denylist: ctrl.getConfig().denylist })
  }

  return NextResponse.json({
    error: 'unknown_action',
    valid_actions: ['test', 'update', 'add_allow', 'remove_allow', 'add_deny', 'remove_deny'],
  }, { status: 400 })
}

export const GET  = tracedRoute('GET',  '/api/admin/ip-access', _GET)
export const POST = tracedRoute('POST', '/api/admin/ip-access', _POST)
