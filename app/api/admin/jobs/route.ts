// keep: enterprise admin surface kept for parity (intentional, not yet wired into UI)
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Job Queue API — background job management and monitoring.
 *
 * GET  /api/admin/jobs — list queued/running/completed jobs with filters
 * POST /api/admin/jobs — enqueue a new job
 *
 * Job types supported:
 *   - email_send         — dispatch queued email notifications
 *   - retention_enforce   — enforce message retention policies
 *   - audit_export        — generate audit log CSV/JSON exports
 *   - backup_run          — trigger a database backup
 *   - file_scan           — virus/malware scan on uploaded files
 *   - guest_expire        — deactivate expired guest accounts
 *   - scheduled_send      — deliver scheduled messages at their send_at time
 *   - index_rebuild       — rebuild full-text search index
 *   - analytics_rollup    — aggregate analytics into daily summaries
 *   - webhook_dispatch    — retry failed webhook deliveries
 *   - invite_expire       — clean up expired invite links
 *
 * Workers poll this table and process jobs in priority order.
 */

const VALID_JOB_TYPES = [
  'email_send', 'retention_enforce', 'audit_export', 'backup_run',
  'file_scan', 'guest_expire', 'scheduled_send', 'index_rebuild',
  'analytics_rollup', 'webhook_dispatch', 'invite_expire',
] as const

type JobType = typeof VALID_JOB_TYPES[number]

async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Admin check
  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const status = req.nextUrl.searchParams.get('status') || ''
  const type = req.nextUrl.searchParams.get('type') || ''
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 50, 200)

  let where = 'WHERE 1=1'
  const params: (string | number)[] = []
  if (status && ['pending', 'running', 'completed', 'failed', 'cancelled'].includes(status)) {
    params.push(status); where += ` AND j.status = $${params.length}`
  }
  if (type && VALID_JOB_TYPES.includes(type as JobType)) {
    params.push(type); where += ` AND j.type = $${params.length}`
  }
  params.push(limit)

  const { rows } = await pool.query(`
    SELECT j.*, u.username AS created_by_username
    FROM aaelink.jobs j
    LEFT JOIN aaelink.users u ON u.id = j.created_by
    ${where}
    ORDER BY j.priority DESC, j.created_at ASC
    LIMIT $${params.length}
  `, params)

  // Summary counts
  const { rows: [summary] } = await pool.query<{
    total: string; pending: string; running: string; completed: string; failed: string
  }>(`
    SELECT
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE status = 'pending')::text AS pending,
      COUNT(*) FILTER (WHERE status = 'running')::text AS running,
      COUNT(*) FILTER (WHERE status = 'completed')::text AS completed,
      COUNT(*) FILTER (WHERE status = 'failed')::text AS failed
    FROM aaelink.jobs
  `)

  return NextResponse.json({
    jobs: rows.map(j => ({
      ...j,
      created_at: Number(j.created_at),
      started_at: Number(j.started_at || 0),
      completed_at: Number(j.completed_at || 0),
      run_after: Number(j.run_after || 0),
    })),
    summary: {
      total: Number(summary.total),
      pending: Number(summary.pending),
      running: Number(summary.running),
      completed: Number(summary.completed),
      failed: Number(summary.failed),
    },
    supported_types: VALID_JOB_TYPES,
  })
}

async function _POST(req: NextRequest) {
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
    type?: string; priority?: number; payload?: Record<string, unknown>
    run_after?: number; max_retries?: number
  }

  const type = body.type || ''
  if (!VALID_JOB_TYPES.includes(type as JobType)) {
    return NextResponse.json({ error: 'invalid_job_type', valid_types: VALID_JOB_TYPES }, { status: 400 })
  }

  const id = randomUUID()
  const now = Date.now()
  const priority = Math.min(Math.max(body.priority || 5, 1), 10)
  const runAfter = body.run_after || now
  const maxRetries = Math.min(body.max_retries || 3, 10)

  await pool.query(`
    INSERT INTO aaelink.jobs
      (id, type, status, priority, payload, run_after, max_retries, attempts, created_by, created_at)
    VALUES ($1, $2, 'pending', $3, $4, $5, $6, 0, $7, $8)
  `, [id, type, priority, JSON.stringify(body.payload || {}), runAfter, maxRetries, uid, now])

  return NextResponse.json({
    job: { id, type, status: 'pending', priority, run_after: runAfter, created_at: now }
  }, { status: 201 })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/admin/jobs', _GET)
export const POST   = tracedRoute('POST', '/api/admin/jobs', _POST)
