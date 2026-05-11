import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * File Scanning API — virus/malware scanning for uploaded files.
 *
 * GET  /api/files/scan — list scan results and queue status
 * POST /api/files/scan — submit a file for scanning / configure scan policy
 *
 * Scan types:
 *   - antivirus    — ClamAV / external AV engine
 *   - malware      — heuristic malware detection
 *   - content_type — verify MIME type matches extension
 *   - size_limit   — enforce file size policies
 *
 * Results:
 *   - clean       — no threats detected
 *   - infected    — threat found (file quarantined)
 *   - suspicious  — flagged for manual review
 *   - error       — scan failed (retry scheduled)
 *   - pending     — in scan queue
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

  const result = req.nextUrl.searchParams.get('result') || '' // 'clean','infected','suspicious','pending'

  let where = ''
  const params: string[] = []
  if (['clean', 'infected', 'suspicious', 'pending', 'error'].includes(result)) {
    params.push(result); where = `WHERE s.result = $${params.length}`
  }

  const { rows } = await pool.query(`
    SELECT s.*, u.username AS uploaded_by_username
    FROM aaelink.file_scans s
    LEFT JOIN aaelink.users u ON u.id = s.uploaded_by
    ${where}
    ORDER BY s.created_at DESC
    LIMIT 100
  `, params)

  // Summary
  const { rows: [summary] } = await pool.query<{
    total: string; clean: string; infected: string
    suspicious: string; pending: string; error: string
  }>(`
    SELECT
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE result = 'clean')::text AS clean,
      COUNT(*) FILTER (WHERE result = 'infected')::text AS infected,
      COUNT(*) FILTER (WHERE result = 'suspicious')::text AS suspicious,
      COUNT(*) FILTER (WHERE result = 'pending')::text AS pending,
      COUNT(*) FILTER (WHERE result = 'error')::text AS error
    FROM aaelink.file_scans
  `)

  // Get scan policy
  const { rows: cfgRows } = await pool.query<{ value: string }>(
    `SELECT value FROM aaelink.system_config WHERE key = 'file_scan_policy'`
  )
  const defaultPolicy = {
    enabled: true,
    scan_on_upload: true,
    quarantine_infected: true,
    max_file_size_mb: 100,
    blocked_extensions: ['.exe', '.bat', '.cmd', '.scr', '.com', '.pif'],
    scan_engine: 'clamav',
    auto_delete_infected_after_days: 30,
  }
  let policy = defaultPolicy
  if (cfgRows[0]?.value) {
    try { policy = { ...defaultPolicy, ...JSON.parse(cfgRows[0].value) } } catch { /**/ }
  }

  return NextResponse.json({
    scans: rows.map(s => ({
      ...s,
      created_at: Number(s.created_at),
      scanned_at: Number(s.scanned_at || 0),
    })),
    summary: {
      total: Number(summary.total),
      clean: Number(summary.clean),
      infected: Number(summary.infected),
      suspicious: Number(summary.suspicious),
      pending: Number(summary.pending),
      error: Number(summary.error),
    },
    policy,
  })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    action?: 'scan_file' | 'update_policy'
    file_id?: string; filename?: string; file_size?: number; mime_type?: string
    policy?: Record<string, unknown>
  }

  if (body.action === 'update_policy') {
    // Admin-only
    const { rows: uRows } = await pool.query<{ platform_role: string }>(
      `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
    )
    if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const { rows: existing } = await pool.query<{ value: string }>(
      `SELECT value FROM aaelink.system_config WHERE key = 'file_scan_policy'`
    )
    let current: Record<string, unknown> = {}
    if (existing[0]?.value) { try { current = JSON.parse(existing[0].value) } catch { /**/ } }

    const updated = { ...current, ...body.policy }
    const now = Date.now()
    await pool.query(`
      INSERT INTO aaelink.system_config (key, value, updated_at)
      VALUES ('file_scan_policy', $1, $2)
      ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = $2
    `, [JSON.stringify(updated), now])

    return NextResponse.json({ policy: updated, updated_at: now })
  }

  // Submit file for scanning
  const fileId = String(body.file_id || '').trim()
  if (!fileId) return NextResponse.json({ error: 'file_id_required' }, { status: 400 })

  const id = randomUUID()
  const now = Date.now()

  await pool.query(`
    INSERT INTO aaelink.file_scans
      (id, file_id, filename, file_size, mime_type, result,
       scan_engine, threat_name, uploaded_by, created_at, scanned_at)
    VALUES ($1, $2, $3, $4, $5, 'pending', 'clamav', '', $6, $7, 0)
  `, [id, fileId, body.filename || '', body.file_size || 0, body.mime_type || '', uid, now])

  // Enqueue scan job
  await pool.query(`
    INSERT INTO aaelink.jobs
      (id, type, status, priority, payload, run_after, max_retries, attempts, created_by, created_at)
    VALUES ($1, 'file_scan', 'pending', 8, $2, $3, 3, 0, $4, $3)
  `, [randomUUID(), JSON.stringify({ scan_id: id, file_id: fileId }), now, uid])

  return NextResponse.json({
    scan: { id, file_id: fileId, result: 'pending', created_at: now }
  }, { status: 201 })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/files/scan', _GET)
export const POST   = tracedRoute('POST', '/api/files/scan', _POST)
