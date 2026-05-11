import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { isPlatformAdmin } from '@/lib/platformRole'
import {
  FEATURE_FLAGS,
  getAllFeatureFlags,
  invalidateFeatureFlagCache
} from '@/lib/featureFlags'
import { randomUUID } from 'crypto'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Feature Flags Admin API — GET/PUT /api/admin/feature-flags
 *
 * GET  — Returns all feature flags with their current resolved state.
 * PUT  — Creates or updates a DB-level override for a specific flag.
 *
 * Admin-only (platform_role check).
 */

async function assertAdmin(pool: ReturnType<typeof getPool>) {
  const uid = await readSessionUserId()
  if (!uid || !pool) return null

  const { rows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  const user = rows[0]
  if (!user || !isPlatformAdmin(user.platform_role)) return null
  return uid
}

/* ── Ensure the feature_flags table exists ─────────────────────────── */
async function ensureFeatureFlagsTable(pool: NonNullable<ReturnType<typeof getPool>>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.feature_flags (
      id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      flag_name   TEXT UNIQUE NOT NULL,
      enabled     BOOLEAN NOT NULL DEFAULT true,
      description TEXT DEFAULT '',
      updated_by  TEXT DEFAULT '',
      updated_at  BIGINT DEFAULT 0,
      deleted_at  BIGINT DEFAULT NULL
    )
  `)
}

/* ── GET ───────────────────────────────────────────────────────────── */
async function _GET() {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await assertAdmin(pool)
  if (!uid) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  await ensureSchema()
  await ensureFeatureFlagsTable(pool)

  const resolved = await getAllFeatureFlags()

  // Also fetch raw DB overrides for display
  let dbOverrides: Record<string, boolean> = {}
  try {
    const { rows } = await pool.query<{ flag_name: string; enabled: boolean }>(
      `SELECT flag_name, enabled FROM aaelink.feature_flags WHERE deleted_at IS NULL`
    )
    for (const r of rows) dbOverrides[r.flag_name] = r.enabled
  } catch { /* table may not exist yet */ }

  // Build the full flag list with source info
  const flags = Object.entries(FEATURE_FLAGS).map(([name, defaultValue]) => {
    const envKey = `FEATURE_${name}`
    const envVal = process.env[envKey]?.toLowerCase()
    const hasEnvOverride = envVal === 'true' || envVal === 'false' || envVal === '1' || envVal === '0'
    const hasDbOverride = name in dbOverrides

    return {
      name,
      enabled: resolved[name as keyof typeof resolved] ?? defaultValue,
      default: defaultValue,
      source: hasEnvOverride ? 'env' : hasDbOverride ? 'db' : 'default',
      env_override: hasEnvOverride ? (envVal === 'true' || envVal === '1') : null,
      db_override: hasDbOverride ? dbOverrides[name] : null
    }
  })

  return NextResponse.json({ flags })
}

/* ── PUT ───────────────────────────────────────────────────────────── */
async function _PUT(req: Request) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await assertAdmin(pool)
  if (!uid) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  await ensureSchema()
  await ensureFeatureFlagsTable(pool)

  const body = (await req.json().catch(() => ({}))) as {
    flag_name?: string
    enabled?: boolean
    action?: 'set' | 'clear'  // 'clear' removes the DB override
  }

  const flagName = body.flag_name?.trim()
  if (!flagName) return NextResponse.json({ error: 'flag_name_required' }, { status: 400 })
  if (!(flagName in FEATURE_FLAGS)) {
    return NextResponse.json({ error: 'unknown_flag', valid_flags: Object.keys(FEATURE_FLAGS) }, { status: 400 })
  }

  if (body.action === 'clear') {
    // Remove DB override (revert to env/default)
    await pool.query(
      `UPDATE aaelink.feature_flags SET deleted_at = $1 WHERE flag_name = $2 AND deleted_at IS NULL`,
      [Date.now(), flagName]
    )
    invalidateFeatureFlagCache()
    return NextResponse.json({ ok: true, action: 'cleared', flag: flagName })
  }

  // Set a DB override
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled_must_be_boolean' }, { status: 400 })
  }

  await pool.query(`
    INSERT INTO aaelink.feature_flags (id, flag_name, enabled, updated_by, updated_at)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (flag_name) DO UPDATE
    SET enabled = $3, updated_by = $4, updated_at = $5, deleted_at = NULL
  `, [randomUUID(), flagName, body.enabled, uid, Date.now()])

  // Audit log
  try {
    await pool.query(
      `INSERT INTO aaelink.audit_log (id, workspace_id, actor_id, action, resource_id, metadata, created_at)
       VALUES ($1, '', $2, 'feature_flag.update', $3, $4, $5)`,
      [randomUUID(), uid, flagName, JSON.stringify({ enabled: body.enabled }), Date.now()]
    )
  } catch { /* audit is best-effort */ }

  invalidateFeatureFlagCache()

  return NextResponse.json({ ok: true, flag: flagName, enabled: body.enabled })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/admin/feature-flags', _GET)
export const PUT    = tracedRoute('PUT', '/api/admin/feature-flags', _PUT)
