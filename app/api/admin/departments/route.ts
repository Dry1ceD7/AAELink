import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { isPlatformAdmin } from '@/lib/platformRole'
import { tracedRoute } from '@/lib/tracedRoute'

/** GET /api/admin/departments — list all departments. */
async function _GET() {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!isPlatformAdmin(uRows[0]?.platform_role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { rows } = await pool.query(
    `SELECT d.id, d.workspace_id, d.code, d.name, d.created_at,
            (SELECT COUNT(*) FROM aaelink.workspace_members wm WHERE wm.department_id = d.id) AS member_count
     FROM aaelink.departments d
     ORDER BY d.name`
  )

  return NextResponse.json({ departments: rows })
}

/** POST /api/admin/departments — create a new department.  Body: { name, code?, workspace_id } */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!isPlatformAdmin(uRows[0]?.platform_role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  let body: { name?: string; code?: string; workspace_id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const name = (body.name || '').trim()
  if (!name || name.length < 2) {
    return NextResponse.json({ error: 'name_required' }, { status: 400 })
  }
  const code = (body.code || name.toLowerCase().replace(/[^a-z0-9]+/g, '-')).slice(0, 40)
  const wsId = body.workspace_id || 'aaelink-ws-global'

  const id = `dep-${code}-${wsId}`
  try {
    await pool.query(
      `INSERT INTO aaelink.departments (id, workspace_id, code, name, created_at) VALUES ($1, $2, $3, $4, $5)`,
      [id, wsId, code, name, Date.now()]
    )

    const ipAddress = req.headers.get('x-forwarded-for') || '127.0.0.1'
    const userAgent = req.headers.get('user-agent') || ''
    await pool.query(`
      INSERT INTO aaelink.audit_log (id, actor_id, actor_role, action, resource_kind, resource_id, ip_address, user_agent, metadata, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      randomUUID(), uid, uRows[0]?.platform_role || '', 'admin_create_department', 'department', id,
      ipAddress, userAgent, JSON.stringify({ name, code, wsId }), Date.now()
    ])
  } catch (e: unknown) {
    const c = (e as { code?: string })?.code
    if (c === '23505') {
      return NextResponse.json({ error: 'department_already_exists' }, { status: 409 })
    }
    throw e
  }

  return NextResponse.json({ department: { id, code, name, workspace_id: wsId } }, { status: 201 })
}

/** DELETE /api/admin/departments?id=... — delete a department. Platform admin only. */
async function _DELETE(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!isPlatformAdmin(uRows[0]?.platform_role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const depId = req.nextUrl.searchParams.get('id') ?? ''
  if (!depId) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  // Clear department_id from members first
  await pool.query(
    `UPDATE aaelink.workspace_members SET department_id = NULL WHERE department_id = $1`,
    [depId]
  )

  await pool.query(`DELETE FROM aaelink.departments WHERE id = $1`, [depId])

  // Audit log
  const ipAddress = req.headers.get('x-forwarded-for') || '127.0.0.1'
  const userAgent = req.headers.get('user-agent') || ''
  await pool.query(`
    INSERT INTO aaelink.audit_log (id, actor_id, actor_role, action, resource_kind, resource_id, ip_address, user_agent, metadata, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `, [
    randomUUID(), uid, uRows[0]?.platform_role || '', 'admin_delete_department', 'department', depId,
    ipAddress, userAgent, JSON.stringify({}), Date.now()
  ])

  return NextResponse.json({ deleted: true })
}

/** PATCH /api/admin/departments — rename a department.  Body: { id, name } */
async function _PATCH(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!isPlatformAdmin(uRows[0]?.platform_role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  let body: { id?: string; name?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }) }

  const depId = (body.id || '').trim()
  const name = (body.name || '').trim()
  if (!depId) return NextResponse.json({ error: 'id_required' }, { status: 400 })
  if (!name || name.length < 2) return NextResponse.json({ error: 'name_required' }, { status: 400 })

  // Get old name for audit
  const { rows: oldRows } = await pool.query<{ name: string }>(
    `SELECT name FROM aaelink.departments WHERE id = $1`, [depId]
  )
  if (!oldRows[0]) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const oldName = oldRows[0].name

  await pool.query(
    `UPDATE aaelink.departments SET name = $1 WHERE id = $2`,
    [name, depId]
  )

  // Audit log
  const ipAddress = req.headers.get('x-forwarded-for') || '127.0.0.1'
  const userAgent = req.headers.get('user-agent') || ''
  await pool.query(`
    INSERT INTO aaelink.audit_log (id, actor_id, actor_role, action, resource_kind, resource_id, ip_address, user_agent, metadata, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `, [
    randomUUID(), uid, uRows[0]?.platform_role || '', 'admin_rename_department', 'department', depId,
    ipAddress, userAgent, JSON.stringify({ old_name: oldName, new_name: name }), Date.now()
  ])

  return NextResponse.json({ ok: true, department: { id: depId, name } })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/admin/departments', _GET)
export const POST   = tracedRoute('POST', '/api/admin/departments', _POST)
export const PATCH  = tracedRoute('PATCH', '/api/admin/departments', _PATCH)
export const DELETE = tracedRoute('DELETE', '/api/admin/departments', _DELETE)
