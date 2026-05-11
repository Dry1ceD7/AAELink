import { NextRequest, NextResponse } from 'next/server'
import { metrics } from '@/lib/tracing'
import { readSessionUserId } from '@/lib/session'
import { getPool } from '@/lib/db'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * GET /api/admin/tracing — Observability dashboard data
 *
 * Returns route-level metrics, system metrics, and recent traces.
 * Requires platform_admin role.
 *
 * Query params:
 *   ?view=metrics|traces|all (default: all)
 *   ?limit=50 (for traces)
 */
async function _GET(req: NextRequest) {
  const userId = await readSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const { rows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`,
    [userId]
  )
  const role = rows[0]?.platform_role
  if (!['super_admin', 'it_admin'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const view = url.searchParams.get('view') || 'all'
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200)

  const result: Record<string, unknown> = { ok: true }

  if (view === 'all' || view === 'metrics') {
    result.system = metrics.getSystemMetrics()
    result.routes = metrics.getRouteMetrics()
  }

  if (view === 'all' || view === 'traces') {
    result.traces = metrics.getRecentSpans(limit)
  }

  return NextResponse.json(result)
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/admin/tracing', _GET)
