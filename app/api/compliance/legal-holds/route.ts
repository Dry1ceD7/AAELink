import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Legal Hold API — compliance hold management for eDiscovery.
 *
 * GET    /api/compliance/legal-holds — list all active/released holds
 * POST   /api/compliance/legal-holds — create a new hold
 * PATCH  /api/compliance/legal-holds?hold_id=... — update/release a hold
 * DELETE /api/compliance/legal-holds?hold_id=... — permanently remove hold record
 *
 * A legal hold:
 *   - Prevents deletion of messages/files for specified users or channels
 *   - Overrides retention policies for held content
 *   - Tracks custodians (users) and scope (channels, date ranges)
 *   - Maintains full audit trail of hold lifecycle
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

  const status = req.nextUrl.searchParams.get('status') || ''

  let where = ''
  const params: string[] = []
  if (status === 'active' || status === 'released') {
    params.push(status); where = `WHERE h.status = $${params.length}`
  }

  const { rows } = await pool.query(`
    SELECT h.*, u.username AS created_by_username
    FROM aaelink.legal_holds h
    LEFT JOIN aaelink.users u ON u.id = h.created_by
    ${where}
    ORDER BY h.created_at DESC
    LIMIT 200
  `, params)

  return NextResponse.json({
    holds: rows.map(h => ({
      ...h,
      created_at: Number(h.created_at),
      released_at: Number(h.released_at || 0),
      scope_from: Number(h.scope_from || 0),
      scope_to: Number(h.scope_to || 0),
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
    name?: string; description?: string; matter_id?: string
    custodian_ids?: string[]; channel_ids?: string[]
    scope_from?: number; scope_to?: number
  }

  const name = String(body.name || '').trim()
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })

  const custodians = Array.isArray(body.custodian_ids) ? body.custodian_ids.slice(0, 500) : []
  const channels = Array.isArray(body.channel_ids) ? body.channel_ids.slice(0, 100) : []
  if (custodians.length === 0 && channels.length === 0) {
    return NextResponse.json({ error: 'must_specify_custodians_or_channels' }, { status: 400 })
  }

  const id = randomUUID()
  const now = Date.now()

  await pool.query(`
    INSERT INTO aaelink.legal_holds
      (id, name, description, matter_id, status, custodian_ids, channel_ids,
       scope_from, scope_to, created_by, created_at)
    VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $8, $9, $10)
  `, [
    id, name, body.description || '', body.matter_id || '',
    JSON.stringify(custodians), JSON.stringify(channels),
    body.scope_from || 0, body.scope_to || 0, uid, now
  ])

  // Audit trail
  await pool.query(`
    INSERT INTO aaelink.audit_log (id, actor_id, action, resource_kind, resource_id, metadata, created_at)
    VALUES ($1, $2, 'legal_hold_created', 'legal_hold', $3, $4, $5)
  `, [randomUUID(), uid, id, JSON.stringify({
    name, custodian_count: custodians.length, channel_count: channels.length
  }), now])

  return NextResponse.json({
    hold: { id, name, status: 'active', custodian_count: custodians.length, channel_count: channels.length, created_at: now }
  }, { status: 201 })
}

async function _PATCH(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const holdId = req.nextUrl.searchParams.get('hold_id')?.trim() || ''
  if (!holdId) return NextResponse.json({ error: 'hold_id_required' }, { status: 400 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: 'release' | 'update'; name?: string; description?: string
    custodian_ids?: string[]; channel_ids?: string[]
  }

  const now = Date.now()

  if (body.action === 'release') {
    const { rowCount } = await pool.query(
      `UPDATE aaelink.legal_holds SET status = 'released', released_at = $1 WHERE id = $2 AND status = 'active'`,
      [now, holdId]
    )
    if (!rowCount) return NextResponse.json({ error: 'hold_not_found_or_already_released' }, { status: 404 })

    await pool.query(`
      INSERT INTO aaelink.audit_log (id, actor_id, action, resource_kind, resource_id, created_at)
      VALUES ($1, $2, 'legal_hold_released', 'legal_hold', $3, $4)
    `, [randomUUID(), uid, holdId, now])

    return NextResponse.json({ ok: true, status: 'released', released_at: now })
  }

  // Update hold metadata
  const updates: string[] = []
  const params: (string | number)[] = []
  if (body.name !== undefined) { params.push(body.name); updates.push(`name = $${params.length}`) }
  if (body.description !== undefined) { params.push(body.description); updates.push(`description = $${params.length}`) }
  if (body.custodian_ids !== undefined) {
    params.push(JSON.stringify(body.custodian_ids)); updates.push(`custodian_ids = $${params.length}`)
  }
  if (body.channel_ids !== undefined) {
    params.push(JSON.stringify(body.channel_ids)); updates.push(`channel_ids = $${params.length}`)
  }
  if (updates.length === 0) return NextResponse.json({ error: 'no_updates' }, { status: 400 })

  params.push(holdId)
  const { rowCount } = await pool.query(
    `UPDATE aaelink.legal_holds SET ${updates.join(', ')} WHERE id = $${params.length}`, params
  )
  if (!rowCount) return NextResponse.json({ error: 'hold_not_found' }, { status: 404 })

  return NextResponse.json({ ok: true, updated: holdId })
}

async function _DELETE(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const holdId = req.nextUrl.searchParams.get('hold_id')?.trim() || ''
  if (!holdId) return NextResponse.json({ error: 'hold_id_required' }, { status: 400 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (uRows[0]?.platform_role !== 'super_admin') {
    return NextResponse.json({ error: 'super_admin_only' }, { status: 403 })
  }

  // Only allow deleting released holds
  const { rowCount } = await pool.query(
    `DELETE FROM aaelink.legal_holds WHERE id = $1 AND status = 'released'`, [holdId]
  )
  if (!rowCount) return NextResponse.json({ error: 'hold_not_found_or_still_active' }, { status: 404 })

  return NextResponse.json({ ok: true, deleted: holdId })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/compliance/legal-holds', _GET)
export const POST   = tracedRoute('POST', '/api/compliance/legal-holds', _POST)
export const PATCH  = tracedRoute('PATCH', '/api/compliance/legal-holds', _PATCH)
export const DELETE = tracedRoute('DELETE', '/api/compliance/legal-holds', _DELETE)
