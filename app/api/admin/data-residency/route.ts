// keep: enterprise admin surface kept for parity (intentional, not yet wired into UI)
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Data Residency API — region pinning and data locality configuration.
 *
 * GET  /api/admin/data-residency — view data residency policies and region assignments
 * PUT  /api/admin/data-residency — update data residency configuration
 *
 * Features:
 *   - Organization-level region pinning (EU, US, APAC, etc.)
 *   - Per-workspace region overrides
 *   - Data classification labels (public, internal, confidential, restricted)
 *   - Storage location enforcement
 *   - Cross-region replication policies
 *   - Compliance region reporting
 */
async function _GET(req: NextRequest) {
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

  // Get global residency config
  const { rows: cfgRows } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = 'data_residency'`
  )

  const defaultConfig = {
    primary_region: 'us-east-1',
    allowed_regions: ['us-east-1', 'eu-west-1', 'ap-southeast-1'],
    default_classification: 'internal',
    enforce_region_pinning: false,
    cross_region_replication: false,
    data_retention_by_region: {} as Record<string, number>,
    workspace_overrides: {} as Record<string, string>,
  }

  let config = defaultConfig
  if (cfgRows[0]?.value) {
    try { config = { ...defaultConfig, ...JSON.parse(cfgRows[0].value) } } catch { /**/ }
  }

  // Regions reference
  const regions = [
    { id: 'us-east-1', name: 'US East (Virginia)', jurisdiction: 'US', gdpr: false },
    { id: 'us-west-2', name: 'US West (Oregon)', jurisdiction: 'US', gdpr: false },
    { id: 'eu-west-1', name: 'EU West (Ireland)', jurisdiction: 'EU', gdpr: true },
    { id: 'eu-central-1', name: 'EU Central (Frankfurt)', jurisdiction: 'EU', gdpr: true },
    { id: 'ap-southeast-1', name: 'Asia Pacific (Singapore)', jurisdiction: 'APAC', gdpr: false },
    { id: 'ap-northeast-1', name: 'Asia Pacific (Tokyo)', jurisdiction: 'APAC', gdpr: false },
    { id: 'ca-central-1', name: 'Canada (Montreal)', jurisdiction: 'CA', gdpr: false },
    { id: 'sa-east-1', name: 'South America (São Paulo)', jurisdiction: 'SA', gdpr: false },
  ]

  const classifications = [
    { level: 'public', description: 'No restrictions on storage location', retention_override: false },
    { level: 'internal', description: 'Standard enterprise data', retention_override: false },
    { level: 'confidential', description: 'Must stay within primary region', retention_override: true },
    { level: 'restricted', description: 'Strict region pinning + encryption required', retention_override: true },
  ]

  return NextResponse.json({
    config,
    available_regions: regions,
    classifications,
  })
}

async function _PUT(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (uRows[0]?.platform_role !== 'super_admin') {
    return NextResponse.json({ error: 'super_admin_only' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    primary_region?: string; allowed_regions?: string[]
    default_classification?: string; enforce_region_pinning?: boolean
    cross_region_replication?: boolean
    workspace_overrides?: Record<string, string>
    data_retention_by_region?: Record<string, number>
  }

  // Get existing
  const { rows: cfgRows } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = 'data_residency'`
  )
  let current: Record<string, unknown> = {}
  if (cfgRows[0]?.value) { try { current = JSON.parse(cfgRows[0].value) } catch { /**/ } }

  const updated = { ...current, ...body }
  const now = Date.now()

  await pool.query(`
    INSERT INTO aaelink.system_config (key, value, updated_at)
    VALUES ('data_residency', $1, $2)
    ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = $2
  `, [JSON.stringify(updated), now])

  await pool.query(`
    INSERT INTO aaelink.audit_log (id, actor_id, action, target_type, target_id, meta, created_at)
    VALUES ($1, $2, 'data_residency_updated', 'system', 'data_residency', $3, $4)
  `, [randomUUID(), uid, JSON.stringify({ primary_region: updated.primary_region }), now])

  return NextResponse.json({ config: updated, updated_at: now })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/admin/data-residency', _GET)
export const PUT    = tracedRoute('PUT', '/api/admin/data-residency', _PUT)
