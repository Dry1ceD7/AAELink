import { NextRequest, NextResponse } from 'next/server'
import { serializeMetrics } from '@/lib/infra/metrics'
import { readSessionUserId } from '@/lib/auth/session'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Prometheus-compatible Metrics Endpoint
 *
 * GET /api/metrics — returns all metrics in Prometheus text exposition format
 *
 * Access control:
 *   - Requires super_admin or platform_admin role
 *   - OR a valid `METRICS_TOKEN` query param matching env var
 *
 * Scrape config for Prometheus:
 *   - job_name: 'aaelink'
 *     metrics_path: '/api/metrics'
 *     params: { token: ['<METRICS_TOKEN>'] }
 *     static_configs:
 *       - targets: ['localhost:3040']
 */
async function _GET(req: NextRequest) {
  // Token-based auth for Prometheus scraper
  const token = req.nextUrl.searchParams.get('token') || ''
  const envToken = process.env.METRICS_TOKEN || ''

  if (envToken && token === envToken) {
    // Token auth — valid
  } else {
    // Fall back to session auth
    await ensureSchema()
    const pool = getPool()
    if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
    const uid = await readSessionUserId()
    if (!uid) return new NextResponse('Unauthorized', { status: 401 })

    const { rows } = await pool.query<{ platform_role: string }>(
      `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
    )
    if (!['super_admin', 'platform_admin'].includes(rows[0]?.platform_role || '')) {
      return new NextResponse('Forbidden', { status: 403 })
    }
  }

  const body = serializeMetrics()

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/metrics', _GET)
