import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

interface RateLimitConfig {
  global_rpm?: number; auth_rpm?: number; api_rpm?: number
  search_rpm?: number; file_upload_rpm?: number; webhook_rpm?: number
  admin_rpm?: number; burst_multiplier?: number; block_duration_seconds?: number
  whitelist_ips?: string[]; whitelist_user_ids?: string[]
  [key: string]: unknown
}

/**
 * Rate Limit Dashboard API — real-time rate limit metrics.
 *
 * GET /api/admin/rate-limits — current rate limit status for all routes/users
 * PUT /api/admin/rate-limits — update rate limit configuration
 *
 * Views:
 *   ?view=overview  — aggregate rate limit stats
 *   ?view=routes    — per-route rate limit status
 *   ?view=users     — per-user rate limit status (top consumers)
 *   ?view=config    — current rate limit configuration
 *   ?view=violations — recent rate limit violations
 *
 * Platform admin only.
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

  const view = req.nextUrl.searchParams.get('view') || 'overview'

  if (view === 'config') {
    const config = await getConfig(pool, 'rate_limit_config')
    const defaults = {
      global_rpm: 300,            // requests per minute, global
      auth_rpm: 10,               // login attempts per minute
      api_rpm: 120,               // API calls per minute per user
      search_rpm: 30,             // search requests per minute
      file_upload_rpm: 20,        // file uploads per minute
      webhook_rpm: 60,            // webhook deliveries per minute per endpoint
      admin_rpm: 60,              // admin API calls per minute
      burst_multiplier: 2,        // allow 2x burst for short periods
      block_duration_seconds: 60, // block for 60s after exceeding limit
      whitelist_ips: [],          // IPs exempt from rate limiting
      whitelist_user_ids: [],     // users exempt from rate limiting
    }
    return NextResponse.json({ config: { ...defaults, ...((config ?? {}) as RateLimitConfig) } })
  }

  if (view === 'violations') {
    const since = Number(req.nextUrl.searchParams.get('since') || Date.now() - 86400000)
    const { rows } = await pool.query<{
      id: string; actor_id: string; action: string;
      details: string; created_at: number;
    }>(`
      SELECT * FROM aaelink.audit_log
      WHERE action = 'rate_limit.exceeded' AND created_at > $1
      ORDER BY created_at DESC
      LIMIT 100
    `, [since])

    return NextResponse.json({
      violations: rows.map(r => {
        let details: Record<string, unknown> = {}
        try { details = JSON.parse(String(r.details || '{}')) } catch { /**/ }
        return {
          id: r.id,
          actor_id: r.actor_id,
          action: r.action,
          route: details.route || '',
          ip: details.ip || '',
          limit: details.limit || 0,
          actual: details.actual || 0,
          created_at: r.created_at,
        }
      }),
    })
  }

  if (view === 'routes') {
    // Aggregate route usage from audit log
    const now = Date.now()
    const hour = 3600000
    const { rows } = await pool.query(`
      SELECT 
        COALESCE(
          CASE 
            WHEN action LIKE 'api.%' THEN action
            ELSE 'other'
          END, 'other'
        ) AS route,
        COUNT(*)::int AS requests_1h
      FROM aaelink.audit_log
      WHERE created_at > $1
      GROUP BY route
      ORDER BY requests_1h DESC
      LIMIT 50
    `, [now - hour])

    return NextResponse.json({ routes: rows })
  }

  if (view === 'users') {
    // Top API consumers in last hour
    const now = Date.now()
    const { rows } = await pool.query(`
      SELECT 
        a.actor_id,
        u.display_name,
        u.email,
        COUNT(*)::int AS requests_1h
      FROM aaelink.audit_log a
      LEFT JOIN aaelink.users u ON u.id = a.actor_id
      WHERE a.created_at > $1 AND a.actor_id IS NOT NULL AND a.actor_id != ''
      GROUP BY a.actor_id, u.display_name, u.email
      ORDER BY requests_1h DESC
      LIMIT 25
    `, [now - 3600000])

    return NextResponse.json({ users: rows })
  }

  // Overview — aggregate stats
  const now = Date.now()
  const hour = 3600000
  const { rows: [stats] } = await pool.query<{
    total_1h: string; violations_1h: string
    unique_users_1h: string; unique_ips_1h: string
  }>(`
    SELECT
      (SELECT COUNT(*)::text FROM aaelink.audit_log WHERE created_at > $1) AS total_1h,
      (SELECT COUNT(*)::text FROM aaelink.audit_log WHERE action = 'rate_limit.exceeded' AND created_at > $1) AS violations_1h,
      (SELECT COUNT(DISTINCT actor_id)::text FROM aaelink.audit_log WHERE created_at > $1 AND actor_id IS NOT NULL AND actor_id != '') AS unique_users_1h,
      '0' AS unique_ips_1h
  `, [now - hour])

  return NextResponse.json({
    overview: {
      total_requests_1h: Number(stats?.total_1h || 0),
      rate_limit_violations_1h: Number(stats?.violations_1h || 0),
      unique_users_1h: Number(stats?.unique_users_1h || 0),
      status: Number(stats?.violations_1h || 0) > 100 ? 'elevated' : 'normal',
    },
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
  if (!['super_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as Partial<RateLimitConfig>

  const allowedKeys = [
    'global_rpm', 'auth_rpm', 'api_rpm', 'search_rpm', 'file_upload_rpm',
    'webhook_rpm', 'admin_rpm', 'burst_multiplier', 'block_duration_seconds',
    'whitelist_ips', 'whitelist_user_ids',
  ]

  const currentConfig = ((await getConfig(pool, 'rate_limit_config')) ?? {}) as RateLimitConfig
  for (const key of allowedKeys) {
    if (body[key] !== undefined) currentConfig[key] = body[key]
  }

  await setConfig(pool, 'rate_limit_config', currentConfig, uid)
  return NextResponse.json({ ok: true, config: currentConfig })
}

// ── Config helpers ───────────────────────────────────────────────────

async function getConfig(pool: Pool, key: string): Promise<unknown> {
  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = $1`, [key]
  )
  if (!rows[0]) return null
  try { return JSON.parse(rows[0].value) } catch { return rows[0].value }
}

async function setConfig(pool: Pool, key: string, value: unknown, updatedBy: string) {
  const json = JSON.stringify(value)
  await pool.query(`
    INSERT INTO aaelink.system_config (key, value, updated_at, updated_by)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3, updated_by = $4
  `, [key, json, Date.now(), updatedBy])
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/admin/rate-limits', _GET)
export const PUT    = tracedRoute('PUT', '/api/admin/rate-limits', _PUT)
