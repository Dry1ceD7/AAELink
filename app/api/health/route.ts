import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Health Check API — Kubernetes readiness/liveness probes.
 *
 * GET /api/health — basic liveness check (fast, always checks DB)
 * GET /api/health?deep=true — deep readiness check (DB + S3 + Stirling)
 *
 * Probe config for Kubernetes:
 *   livenessProbe:
 *     httpGet: { path: /api/health, port: 3040 }
 *     initialDelaySeconds: 10
 *     periodSeconds: 15
 *   readinessProbe:
 *     httpGet: { path: /api/health?deep=true, port: 3040 }
 *     initialDelaySeconds: 5
 *     periodSeconds: 10
 *     failureThreshold: 3
 *
 * No authentication required (for load balancer / k8s probes).
 */
async function _GET(req: NextRequest) {
  const deep = req.nextUrl.searchParams.get('deep') === 'true'
  const start = performance.now()
  const checks: Record<string, { status: 'ok' | 'error'; latency_ms?: number; error?: string }> = {}

  // ── PostgreSQL (always checked) ──
  const pool = getPool()
  if (pool) {
    const dbStart = performance.now()
    try {
      await pool.query('SELECT 1')
      checks.postgres = { status: 'ok', latency_ms: Math.round(performance.now() - dbStart) }
    } catch (e) {
      checks.postgres = { status: 'error', latency_ms: Math.round(performance.now() - dbStart), error: String(e) }
    }
  } else {
    checks.postgres = { status: 'error', error: 'pool_not_configured' }
  }

  // ── Deep checks (S3 + Stirling PDF) ──
  if (deep) {
    // S3 / MinIO
    const s3Endpoint = process.env.S3_ENDPOINT || 'http://127.0.0.1:9000'
    const s3Start = performance.now()
    try {
      const res = await fetch(`${s3Endpoint}/minio/health/live`, { signal: AbortSignal.timeout(3000) })
      checks.s3 = {
        status: res.ok ? 'ok' : 'error',
        latency_ms: Math.round(performance.now() - s3Start),
        ...(res.ok ? {} : { error: `status ${res.status}` }),
      }
    } catch (e) {
      checks.s3 = { status: 'error', latency_ms: Math.round(performance.now() - s3Start), error: String(e) }
    }

    // Stirling PDF
    const stirlingUrl = process.env.STIRLING_URL || 'http://127.0.0.1:28080'
    const stStart = performance.now()
    try {
      const res = await fetch(`${stirlingUrl}/api/v1/general/alive`, { signal: AbortSignal.timeout(3000) })
      checks.stirling_pdf = {
        status: res.ok ? 'ok' : 'error',
        latency_ms: Math.round(performance.now() - stStart),
        ...(res.ok ? {} : { error: `status ${res.status}` }),
      }
    } catch (e) {
      checks.stirling_pdf = { status: 'error', latency_ms: Math.round(performance.now() - stStart), error: String(e) }
    }

    // Job queue health
    if (pool) {
      try {
        const { rows: [jobStats] } = await pool.query<{
          pending: string; running: string; failed: string
        }>(`
          SELECT
            (SELECT COUNT(*)::text FROM aaelink.jobs WHERE status = 'pending') AS pending,
            (SELECT COUNT(*)::text FROM aaelink.jobs WHERE status = 'running') AS running,
            (SELECT COUNT(*)::text FROM aaelink.jobs WHERE status = 'failed' AND created_at > $1) AS failed
        `, [Date.now() - 86400000])

        const failedCount = Number(jobStats?.failed || 0)
        checks.job_queue = {
          status: failedCount > 50 ? 'error' : 'ok',
          ...(failedCount > 50 ? { error: `${failedCount} failed jobs in 24h` } : {}),
        }
      } catch { /* job queue check is non-critical */ }
    }
  }

  // ── Overall status ──
  const allOk = Object.values(checks).every(c => c.status === 'ok')
  const totalLatency = Math.round(performance.now() - start)
  const mem = process.memoryUsage()

  return NextResponse.json({
    status: allOk ? 'healthy' : 'degraded',
    version: '0.0.8-alpha',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    latency_ms: totalLatency,
    node_version: process.version,
    memory: {
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
      rss_mb: Math.round(mem.rss / 1024 / 1024),
    },
    checks,
  }, {
    status: allOk ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/health', _GET)
