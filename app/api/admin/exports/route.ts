import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { isPlatformAdmin } from '@/lib/platformRole'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * GET /api/admin/exports — list export jobs.
 * POST /api/admin/exports — create a new export job.
 * PATCH /api/admin/exports — update export status (for workers).
 *
 * Export jobs stored in `aaelink.export_jobs`.
 */

const EXPORTS_DDL = `
  CREATE TABLE IF NOT EXISTS aaelink.export_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type            TEXT NOT NULL CHECK (type IN ('full','messages','files','members','channels')),
    status          TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed')),
    requested_by    UUID NOT NULL REFERENCES aaelink.users(id),
    date_from       TIMESTAMPTZ,
    date_to         TIMESTAMPTZ,
    channels_filter TEXT[],
    file_size       BIGINT,
    file_url        TEXT,
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS idx_exports_status ON aaelink.export_jobs(status, created_at DESC);
`

async function ensureExports(pool: ReturnType<typeof getPool>) {
  if (!pool) return
  await pool.query(EXPORTS_DDL)
}

async function _GET(req: NextRequest) {
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

  await ensureExports(pool)

  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 20, 100)
  const offset = Math.max(Number(req.nextUrl.searchParams.get('offset')) || 0, 0)

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM aaelink.export_jobs`
  )
  const total = (countRows[0] as { total: number })?.total || 0

  const { rows } = await pool.query(
    `SELECT e.*, u.username AS requested_by_username
     FROM aaelink.export_jobs e
     LEFT JOIN aaelink.users u ON u.id = e.requested_by
     ORDER BY e.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  )

  return NextResponse.json({ exports: rows, total, limit, offset })
}

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

  await ensureExports(pool)

  const body = await req.json()
  const { type, date_from, date_to, channels } = body as {
    type: string; date_from?: string; date_to?: string; channels?: string[]
  }

  if (!['full', 'messages', 'files', 'members', 'channels'].includes(type)) {
    return NextResponse.json({ error: 'invalid_type' }, { status: 400 })
  }

  const { rows } = await pool.query(
    `INSERT INTO aaelink.export_jobs (type, requested_by, date_from, date_to, channels_filter)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [type, uid, date_from || null, date_to || null, channels || null]
  )

  // Log export request
  await pool.query(
    `INSERT INTO aaelink.audit_log (actor_id, action, target_type, target_id, metadata)
     VALUES ($1, 'export.create', 'export', $2, $3)`,
    [uid, rows[0].id, JSON.stringify({ type })]
  ).catch(() => {})

  return NextResponse.json({ export: rows[0] }, { status: 201 })
}

async function _PATCH(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json()
  const { id, status, file_url, file_size, error_message } = body as {
    id: string; status: string; file_url?: string; file_size?: number; error_message?: string
  }

  if (!id || !['processing', 'completed', 'failed'].includes(status)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const setClauses: string[] = [`status = $2`]
  const params: (string | number | null)[] = [id, status]

  if (status === 'processing') {
    setClauses.push(`started_at = now()`)
  }
  if (status === 'completed') {
    setClauses.push(`completed_at = now()`)
    if (file_url) { params.push(file_url); setClauses.push(`file_url = $${params.length}`) }
    if (file_size) { params.push(file_size); setClauses.push(`file_size = $${params.length}`) }
  }
  if (status === 'failed' && error_message) {
    params.push(error_message); setClauses.push(`error_message = $${params.length}`)
  }

  await pool.query(
    `UPDATE aaelink.export_jobs SET ${setClauses.join(', ')} WHERE id = $1`,
    params
  )

  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/admin/exports', _GET)
export const POST   = tracedRoute('POST', '/api/admin/exports', _POST)
export const PATCH  = tracedRoute('PATCH', '/api/admin/exports', _PATCH)
