// keep: enterprise admin surface kept for parity (intentional, not yet wired into UI)
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Team Profile API — Slack team.profile parity.
 *
 * GET  /api/team/profile — get custom profile field definitions
 * POST /api/team/profile — add/update/delete custom profile fields (admin only)
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  await ensureProfileFieldsTable(pool)

  const { rows } = await pool.query(
    `SELECT id, label, field_type, hint, possible_values, ordering, is_required, is_visible
     FROM aaelink.team_profile_fields
     ORDER BY ordering ASC, label ASC`
  )

  return NextResponse.json({
    profile: {
      fields: rows.map(r => ({
        id: r.id,
        label: r.label,
        type: r.field_type,
        hint: r.hint || '',
        possible_values: r.possible_values ? JSON.parse(r.possible_values as string) : [],
        ordering: r.ordering,
        is_required: r.is_required,
        is_visible: r.is_visible,
      })),
    },
  })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Check admin
  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')) {
    return NextResponse.json({ error: 'admin_required' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: string
    field_id?: string
    label?: string
    field_type?: string
    hint?: string
    possible_values?: string[]
    ordering?: number
    is_required?: boolean
    is_visible?: boolean
  }

  await ensureProfileFieldsTable(pool)
  const now = Date.now()

  if (body.action === 'add') {
    if (!body.label?.trim()) return NextResponse.json({ error: 'label_required' }, { status: 400 })
    const { randomUUID } = await import('crypto')
    const id = randomUUID()
    await pool.query(
      `INSERT INTO aaelink.team_profile_fields (id, label, field_type, hint, possible_values, ordering, is_required, is_visible, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, body.label.trim(), body.field_type || 'text', body.hint || '', JSON.stringify(body.possible_values || []),
       body.ordering ?? 0, body.is_required ?? false, body.is_visible ?? true, now]
    )
    return NextResponse.json({ ok: true, field_id: id })
  }

  if (body.action === 'update') {
    if (!body.field_id) return NextResponse.json({ error: 'field_id_required' }, { status: 400 })
    const sets: string[] = []
    const params: unknown[] = [body.field_id]

    if (body.label !== undefined) { params.push(body.label); sets.push(`label = $${params.length}`) }
    if (body.field_type !== undefined) { params.push(body.field_type); sets.push(`field_type = $${params.length}`) }
    if (body.hint !== undefined) { params.push(body.hint); sets.push(`hint = $${params.length}`) }
    if (body.possible_values !== undefined) { params.push(JSON.stringify(body.possible_values)); sets.push(`possible_values = $${params.length}`) }
    if (body.ordering !== undefined) { params.push(body.ordering); sets.push(`ordering = $${params.length}`) }
    if (body.is_required !== undefined) { params.push(body.is_required); sets.push(`is_required = $${params.length}`) }
    if (body.is_visible !== undefined) { params.push(body.is_visible); sets.push(`is_visible = $${params.length}`) }

    if (sets.length > 0) {
      await pool.query(`UPDATE aaelink.team_profile_fields SET ${sets.join(', ')} WHERE id = $1`, params)
    }
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'delete') {
    if (!body.field_id) return NextResponse.json({ error: 'field_id_required' }, { status: 400 })
    await pool.query(`DELETE FROM aaelink.team_profile_fields WHERE id = $1`, [body.field_id])
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'reorder') {
    // Bulk reorder via possible_values field used as ordered IDs
    const order = body.possible_values || []
    for (let i = 0; i < order.length; i++) {
      await pool.query(`UPDATE aaelink.team_profile_fields SET ordering = $1 WHERE id = $2`, [i, order[i]])
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
}

async function ensureProfileFieldsTable(pool: import('pg').Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aaelink.team_profile_fields (
      id               TEXT PRIMARY KEY,
      label            TEXT NOT NULL DEFAULT '',
      field_type       TEXT NOT NULL DEFAULT 'text',
      hint             TEXT NOT NULL DEFAULT '',
      possible_values  TEXT NOT NULL DEFAULT '[]',
      ordering         INT NOT NULL DEFAULT 0,
      is_required      BOOLEAN NOT NULL DEFAULT false,
      is_visible       BOOLEAN NOT NULL DEFAULT true,
      created_at       BIGINT NOT NULL DEFAULT 0
    )
  `).catch(() => {})
}

export const GET  = tracedRoute('GET',  '/api/team/profile', _GET)
export const POST = tracedRoute('POST', '/api/team/profile', _POST)
