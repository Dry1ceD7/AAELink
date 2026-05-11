import { NextResponse } from 'next/server'
import { metrics } from '@/lib/tracing'
import { getPool } from '@/lib/db'

/**
 * Prometheus / OpenMetrics Exporter
 *
 * GET /api/admin/prometheus — exports metrics in Prometheus exposition format
 *
 * Scrape target for Prometheus: http://<host>:3000/api/admin/prometheus
 * Content-Type: text/plain; version=0.0.4; charset=utf-8
 *
 * Metrics exported:
 *   - aaelink_http_requests_total        (counter)
 *   - aaelink_http_errors_total          (counter)
 *   - aaelink_http_request_duration_ms   (summary p50/p95/p99)
 *   - aaelink_db_connections_total       (gauge)
 *   - aaelink_db_connections_idle        (gauge)
 *   - aaelink_db_connections_waiting     (gauge)
 *   - aaelink_uptime_seconds             (gauge)
 *   - aaelink_routes_tracked             (gauge)
 *   - aaelink_error_rate_percent         (gauge)
 *   - aaelink_users_total                (gauge)
 *   - aaelink_messages_total             (gauge)
 *   - aaelink_channels_total             (gauge)
 */
export async function GET() {
  const sys = metrics.getSystemMetrics()
  const routes = metrics.getRouteMetrics()

  const lines: string[] = []

  const ts = Date.now()

  // ── System-level metrics ──
  lines.push('# HELP aaelink_uptime_seconds Server uptime in seconds')
  lines.push('# TYPE aaelink_uptime_seconds gauge')
  lines.push(`aaelink_uptime_seconds ${Math.floor(sys.uptime_ms / 1000)} ${ts}`)

  lines.push('# HELP aaelink_http_requests_total Total HTTP requests served')
  lines.push('# TYPE aaelink_http_requests_total counter')
  lines.push(`aaelink_http_requests_total ${sys.total_requests} ${ts}`)

  lines.push('# HELP aaelink_http_errors_total Total HTTP error responses (4xx/5xx)')
  lines.push('# TYPE aaelink_http_errors_total counter')
  lines.push(`aaelink_http_errors_total ${sys.total_errors} ${ts}`)

  lines.push('# HELP aaelink_error_rate_percent Error rate as a percentage')
  lines.push('# TYPE aaelink_error_rate_percent gauge')
  lines.push(`aaelink_error_rate_percent ${sys.error_rate} ${ts}`)

  lines.push('# HELP aaelink_avg_latency_ms Average request latency in milliseconds')
  lines.push('# TYPE aaelink_avg_latency_ms gauge')
  lines.push(`aaelink_avg_latency_ms ${sys.avg_latency_ms} ${ts}`)

  lines.push('# HELP aaelink_routes_tracked Number of distinct routes with metrics')
  lines.push('# TYPE aaelink_routes_tracked gauge')
  lines.push(`aaelink_routes_tracked ${sys.routes_tracked} ${ts}`)

  // ── Database connection pool ──
  const pool = getPool()
  if (pool) {
    const p = pool as unknown as { totalCount: number; idleCount: number; waitingCount: number }
    lines.push('# HELP aaelink_db_connections_total Total database connections in pool')
    lines.push('# TYPE aaelink_db_connections_total gauge')
    lines.push(`aaelink_db_connections_total ${p.totalCount || 0} ${ts}`)

    lines.push('# HELP aaelink_db_connections_idle Idle database connections')
    lines.push('# TYPE aaelink_db_connections_idle gauge')
    lines.push(`aaelink_db_connections_idle ${p.idleCount || 0} ${ts}`)

    lines.push('# HELP aaelink_db_connections_waiting Waiting database connection requests')
    lines.push('# TYPE aaelink_db_connections_waiting gauge')
    lines.push(`aaelink_db_connections_waiting ${p.waitingCount || 0} ${ts}`)
  }

  // ── Per-route metrics ──
  if (routes.length > 0) {
    lines.push('# HELP aaelink_route_requests_total Requests per route')
    lines.push('# TYPE aaelink_route_requests_total counter')
    for (const r of routes) {
      const labels = `method="${r.method}",route="${r.route}"`
      lines.push(`aaelink_route_requests_total{${labels}} ${r.count} ${ts}`)
    }

    lines.push('# HELP aaelink_route_errors_total Errors per route')
    lines.push('# TYPE aaelink_route_errors_total counter')
    for (const r of routes) {
      if (r.errors > 0) {
        const labels = `method="${r.method}",route="${r.route}"`
        lines.push(`aaelink_route_errors_total{${labels}} ${r.errors} ${ts}`)
      }
    }

    lines.push('# HELP aaelink_route_latency_p50_ms 50th percentile latency per route (ms)')
    lines.push('# TYPE aaelink_route_latency_p50_ms gauge')
    lines.push('# HELP aaelink_route_latency_p95_ms 95th percentile latency per route (ms)')
    lines.push('# TYPE aaelink_route_latency_p95_ms gauge')
    lines.push('# HELP aaelink_route_latency_p99_ms 99th percentile latency per route (ms)')
    lines.push('# TYPE aaelink_route_latency_p99_ms gauge')
    for (const r of routes) {
      const labels = `method="${r.method}",route="${r.route}"`
      lines.push(`aaelink_route_latency_p50_ms{${labels}} ${Math.round(r.p50Ms * 100) / 100} ${ts}`)
      lines.push(`aaelink_route_latency_p95_ms{${labels}} ${Math.round(r.p95Ms * 100) / 100} ${ts}`)
      lines.push(`aaelink_route_latency_p99_ms{${labels}} ${Math.round(r.p99Ms * 100) / 100} ${ts}`)
    }
  }

  // ── Application-level from DB (best-effort) ──
  if (pool) {
    try {
      const { rows: [u] } = await pool.query<{ c: string }>('SELECT COUNT(*)::text AS c FROM aaelink.users')
      lines.push('# HELP aaelink_users_total Total registered users')
      lines.push('# TYPE aaelink_users_total gauge')
      lines.push(`aaelink_users_total ${u.c} ${ts}`)

      const { rows: [m] } = await pool.query<{ c: string }>('SELECT COUNT(*)::text AS c FROM aaelink.messages')
      lines.push('# HELP aaelink_messages_total Total messages stored')
      lines.push('# TYPE aaelink_messages_total gauge')
      lines.push(`aaelink_messages_total ${m.c} ${ts}`)

      const { rows: [ch] } = await pool.query<{ c: string }>('SELECT COUNT(*)::text AS c FROM aaelink.channels')
      lines.push('# HELP aaelink_channels_total Total channels')
      lines.push('# TYPE aaelink_channels_total gauge')
      lines.push(`aaelink_channels_total ${ch.c} ${ts}`)

      const { rows: [w] } = await pool.query<{ c: string }>('SELECT COUNT(*)::text AS c FROM aaelink.workspaces')
      lines.push('# HELP aaelink_workspaces_total Total workspaces')
      lines.push('# TYPE aaelink_workspaces_total gauge')
      lines.push(`aaelink_workspaces_total ${w.c} ${ts}`)
    } catch {
      // DB queries are best-effort for the metrics endpoint
    }
  }

  lines.push('')

  return new NextResponse(lines.join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Cache-Control': 'no-cache, no-store',
    },
  })
}
