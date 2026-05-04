import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { isSuperAdmin, isPlatformAdmin } from '@/lib/platformRole'

/** GET /api/admin/audit-log — paginated audit log viewer. */
export async function GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Only admins may view
  const { rows: uRows } = await pool.query(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  const role = (uRows[0] as { platform_role?: string })?.platform_role || ''
  if (!isPlatformAdmin(role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 30, 100)
  const offset = Math.max(Number(req.nextUrl.searchParams.get('offset')) || 0, 0)
  const action = req.nextUrl.searchParams.get('action')?.trim() || ''

  let q = `SELECT a.*, u.username AS actor_username FROM aaelink.audit_log a
           LEFT JOIN aaelink.users u ON u.id = a.actor_id`
  const params: (string | number)[] = []
  if (action) {
    q += ` WHERE a.action = $${params.length + 1}`
    params.push(action)
  }
  q += ` ORDER BY a.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
  params.push(limit, offset)

  const { rows } = await pool.query(q, params)
  return NextResponse.json({ entries: rows })
}
