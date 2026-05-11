import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { isPlatformAdmin } from '@/lib/platformRole'
import { tracedRoute } from '@/lib/tracedRoute'
import { RetentionEngine, type RetentionEntity, type RetentionQueryFn } from '@/lib/retention'

/**
 * GET /api/admin/retention — get current retention policies.
 * PUT /api/admin/retention — update retention policies.
 *
 * Policies stored in `aaelink.retention_policies`.
 */

const RETENTION_DDL = `
  CREATE TABLE IF NOT EXISTS aaelink.retention_policies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope           TEXT NOT NULL UNIQUE CHECK (scope IN ('workspace','channel','dm','file')),
    retention_days  INT NOT NULL DEFAULT 0,
    enabled         BOOLEAN NOT NULL DEFAULT false,
    delete_files    BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      UUID REFERENCES aaelink.users(id)
  );

  -- Seed default policies if empty
  INSERT INTO aaelink.retention_policies (scope, retention_days, enabled)
  VALUES
    ('workspace', 0, false),
    ('channel', 0, false),
    ('dm', 0, false),
    ('file', 0, false)
  ON CONFLICT (scope) DO NOTHING;
`

async function ensureRetention(pool: ReturnType<typeof getPool>) {
  if (!pool) return
  await pool.query(RETENTION_DDL)
}

async function _GET(_req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  const role = (uRows[0] as { platform_role?: string })?.platform_role || ''
  if (!isPlatformAdmin(role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  await ensureRetention(pool)

  const { rows } = await pool.query(
    `SELECT p.*, u.username AS updated_by_username
     FROM aaelink.retention_policies p
     LEFT JOIN aaelink.users u ON u.id = p.updated_by
     ORDER BY p.scope`
  )

  return NextResponse.json({ policies: rows })
}

async function _PUT(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  const role = (uRows[0] as { platform_role?: string })?.platform_role || ''
  if (!isPlatformAdmin(role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  await ensureRetention(pool)

  const body = await req.json()
  const { scope, retention_days, enabled, delete_files } = body as {
    scope: string; retention_days: number; enabled: boolean; delete_files?: boolean
  }

  if (!['workspace', 'channel', 'dm', 'file'].includes(scope)) {
    return NextResponse.json({ error: 'invalid_scope' }, { status: 400 })
  }
  if (typeof retention_days !== 'number' || retention_days < 0) {
    return NextResponse.json({ error: 'invalid_retention_days' }, { status: 400 })
  }

  const { rows } = await pool.query(
    `UPDATE aaelink.retention_policies
     SET retention_days = $2, enabled = $3, delete_files = $4, updated_at = now(), updated_by = $5
     WHERE scope = $1
     RETURNING *`,
    [scope, retention_days, enabled, delete_files ?? false, uid]
  )

  // Audit log
  await pool.query(
    `INSERT INTO aaelink.audit_log (actor_id, action, target_type, target_id, metadata)
     VALUES ($1, 'retention.update', 'policy', $2, $3)`,
    [uid, rows[0]?.id || scope, JSON.stringify({ scope, retention_days, enabled })]
  ).catch(() => {})

  return NextResponse.json({ policy: rows[0] })
}

/** POST — execute retention engine operations (preview, execute, execute_all) */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  const role = (uRows[0] as { platform_role?: string })?.platform_role || ''
  if (!isPlatformAdmin(role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: string
    entity?: string
    dry_run?: boolean
  }

  const engine = new RetentionEngine()

  if (body.action === 'list_engine_policies') {
    return NextResponse.json({
      policies: engine.getPolicies().map(p => ({
        ...p,
        cutoff_preview: p.retentionDays > 0
          ? new Date(engine.getCutoffTimestamp(p)).toISOString()
          : 'keep_forever',
      })),
    })
  }

  if (body.action === 'preview' && body.entity) {
    const queryFn: RetentionQueryFn = (sql, params) => pool.query<{ count: number }>(sql, params)
    const result = await engine.preview(body.entity as RetentionEntity, queryFn)
    return NextResponse.json({ result })
  }

  if (body.action === 'execute' && body.entity) {
    const queryFn: RetentionQueryFn = (sql, params) => pool.query<{ count: number }>(sql, params)
    const result = await engine.execute(body.entity as RetentionEntity, queryFn, body.dry_run ?? true)
    return NextResponse.json({ result })
  }

  if (body.action === 'execute_all') {
    const queryFn: RetentionQueryFn = (sql, params) => pool.query<{ count: number }>(sql, params)
    const results = await engine.executeAll(queryFn, body.dry_run ?? true)
    return NextResponse.json({ results })
  }

  return NextResponse.json({
    error: 'unknown_action',
    valid_actions: ['list_engine_policies', 'preview', 'execute', 'execute_all']
  }, { status: 400 })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET  = tracedRoute('GET',  '/api/admin/retention', _GET)
export const PUT  = tracedRoute('PUT',  '/api/admin/retention', _PUT)
export const POST = tracedRoute('POST', '/api/admin/retention', _POST)
