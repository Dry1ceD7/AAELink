// keep: enterprise admin surface kept for parity (intentional, not yet wired into UI)
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * eDiscovery Export API — compliance export jobs for legal/regulatory requirements.
 *
 * GET  /api/compliance/ediscovery — list export jobs
 * POST /api/compliance/ediscovery — create a new export job
 *
 * Export scopes:
 *   - By user (custodian): all messages, files, reactions from specified users
 *   - By channel: all content in specified channels
 *   - By date range: content within a time window
 *   - By legal hold: export everything under a specific hold
 *   - By keyword: search-based export
 *
 * Output formats: JSON (machine-readable), CSV (spreadsheet), MBOX (email standard)
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

  const { rows } = await pool.query(`
    SELECT e.*, u.username AS created_by_username
    FROM aaelink.ediscovery_exports e
    LEFT JOIN aaelink.users u ON u.id = e.created_by
    ORDER BY e.created_at DESC
    LIMIT 100
  `)

  return NextResponse.json({
    exports: rows.map(e => ({
      ...e,
      created_at: Number(e.created_at),
      completed_at: Number(e.completed_at || 0),
      scope_from: Number(e.scope_from || 0),
      scope_to: Number(e.scope_to || 0),
    })),
    total: rows.length,
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
    name?: string; format?: string; legal_hold_id?: string
    custodian_ids?: string[]; channel_ids?: string[]; keywords?: string[]
    scope_from?: number; scope_to?: number
    include_files?: boolean; include_reactions?: boolean; include_threads?: boolean
  }

  const name = String(body.name || '').trim()
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })

  const format = ['json', 'csv', 'mbox'].includes(body.format || '') ? body.format! : 'json'

  const id = randomUUID()
  const now = Date.now()

  const scope = {
    custodian_ids: body.custodian_ids || [],
    channel_ids: body.channel_ids || [],
    keywords: body.keywords || [],
    legal_hold_id: body.legal_hold_id || null,
    include_files: body.include_files !== false,
    include_reactions: body.include_reactions !== false,
    include_threads: body.include_threads !== false,
  }

  await pool.query(`
    INSERT INTO aaelink.ediscovery_exports
      (id, name, status, format, scope, scope_from, scope_to,
       message_count, file_count, size_bytes, created_by, created_at)
    VALUES ($1, $2, 'pending', $3, $4, $5, $6, 0, 0, 0, $7, $8)
  `, [id, name, format, JSON.stringify(scope),
      body.scope_from || 0, body.scope_to || 0, uid, now])

  // Enqueue the export job
  await pool.query(`
    INSERT INTO aaelink.jobs
      (id, type, status, priority, payload, run_after, max_retries, attempts, created_by, created_at)
    VALUES ($1, 'audit_export', 'pending', 7, $2, $3, 3, 0, $4, $3)
  `, [randomUUID(), JSON.stringify({ export_id: id }), now, uid])

  // Audit trail
  await pool.query(`
    INSERT INTO aaelink.audit_log (id, actor_id, action, target_type, target_id, meta, created_at)
    VALUES ($1, $2, 'ediscovery_export_created', 'ediscovery', $3, $4, $5)
  `, [randomUUID(), uid, id, JSON.stringify({ name, format, scope }), now])

  return NextResponse.json({
    export: { id, name, status: 'pending', format, created_at: now }
  }, { status: 201 })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/compliance/ediscovery', _GET)
export const POST   = tracedRoute('POST', '/api/compliance/ediscovery', _POST)
