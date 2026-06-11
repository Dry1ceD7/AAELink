import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isSuperAdmin, isPlatformAdmin } from '@/lib/comms/platformRole'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * GET /api/admin/audit-log — paginated audit log viewer with filters.
 *
 * Query params:
 *  - limit (max 100, default 30)
 *  - offset (default 0)
 *  - action — filter by action type
 *  - actor — filter by actor username (partial match)
 *  - from — start timestamp (epoch ms) for date range
 *  - to — end timestamp (epoch ms) for date range
 */
async function _GET(req: NextRequest) {
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
  const actor = req.nextUrl.searchParams.get('actor')?.trim() || ''
  const from = Number(req.nextUrl.searchParams.get('from')) || 0
  const to = Number(req.nextUrl.searchParams.get('to')) || 0

  const where: string[] = []
  const params: (string | number)[] = []

  if (action) {
    params.push(action)
    where.push(`a.action = $${params.length}`)
  }

  if (actor) {
    params.push(`%${actor}%`)
    where.push(`u.username ILIKE $${params.length}`)
  }

  if (from > 0) {
    params.push(from)
    where.push(`a.created_at >= $${params.length}`)
  }

  if (to > 0) {
    params.push(to)
    where.push(`a.created_at <= $${params.length}`)
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

  // Count total for pagination
  const countQ = `SELECT COUNT(*)::int AS total FROM aaelink.audit_log a
                  LEFT JOIN aaelink.users u ON u.id = a.actor_id
                  ${whereClause}`
  const { rows: countRows } = await pool.query(countQ, params)
  const total = (countRows[0] as { total: number })?.total || 0

  params.push(limit)
  const limitIdx = params.length
  params.push(offset)
  const offsetIdx = params.length

  const q = `SELECT a.*, u.username AS actor_username, u.avatar_url AS actor_avatar_url
             FROM aaelink.audit_log a
             LEFT JOIN aaelink.users u ON u.id = a.actor_id
             ${whereClause}
             ORDER BY a.created_at DESC
             LIMIT $${limitIdx} OFFSET $${offsetIdx}`

  const { rows } = await pool.query(q, params)
  return NextResponse.json({ entries: rows, total, limit, offset })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/admin/audit-log', _GET)
