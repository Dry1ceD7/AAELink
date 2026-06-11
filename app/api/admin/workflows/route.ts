import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Admin workflows management.
 *
 * GET    — search/list workflows (admin view, includes all workspaces)
 * DELETE — unpublish (deactivate) a workflow
 */

async function requireAdmin() {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows } = await pool.query(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!isPlatformAdmin((rows[0] as { platform_role?: string })?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  return { uid, pool }
}

async function _GET(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const search = req.nextUrl.searchParams.get('q') || ''
  const status = req.nextUrl.searchParams.get('status') || ''
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '100', 10), 500)

  let sql = `SELECT * FROM aaelink.workflows WHERE 1=1`
  const params: unknown[] = []
  let idx = 1

  if (search) {
    sql += ` AND (name ILIKE $${idx} OR description ILIKE $${idx})`
    params.push(`%${search}%`)
    idx++
  }
  if (status) {
    sql += ` AND status = $${idx}`
    params.push(status)
    idx++
  }

  sql += ` ORDER BY created_at DESC LIMIT $${idx}`
  params.push(limit)

  const { rows } = await auth.pool.query(sql, params)
  return NextResponse.json({ workflows: rows })
}

async function _DELETE(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const body = await req.json().catch(() => ({})) as { workflow_id?: string }
  if (!body.workflow_id) return NextResponse.json({ error: 'workflow_id_required' }, { status: 400 })

  const res = await auth.pool.query(
    `UPDATE aaelink.workflows SET status = 'unpublished' WHERE id = $1`,
    [body.workflow_id]
  )
  if ((res.rowCount ?? 0) === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true, unpublished: true })
}

export const GET    = tracedRoute('GET',    '/api/admin/workflows', _GET)
export const DELETE = tracedRoute('DELETE', '/api/admin/workflows', _DELETE)
