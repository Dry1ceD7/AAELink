/**
 * AAELink Observability — Lightweight Request Tracing & Metrics
 *
 * This module provides:
 *   1. Request tracing with unique trace IDs and timing
 *   2. Route-level metrics aggregation
 *   3. Health check data for /api/admin/metrics
 *   4. Structured JSON logging for observability
 *
 * Designed to work without external dependencies — OpenTelemetry-compatible
 * trace headers (traceparent) are generated and propagated.
 *
 * Usage:
 *   import { trace, metrics } from '@/lib/tracing'
 *
 *   export async function GET(req: NextRequest) {
 *     const span = trace.startSpan('GET /api/channels')
 *     try {
 *       // ... your logic
 *       span.setStatus('ok')
 *       return NextResponse.json({ ok: true })
 *     } catch (err) {
 *       span.setStatus('error', err)
 *       throw err
 *     } finally {
 *       span.end()
 *     }
 *   }
 */

import { randomUUID } from 'crypto'

// ── Types ────────────────────────────────────────────────────────────

interface SpanContext {
  traceId: string
  spanId: string
  parentSpanId?: string
}

interface Span {
  context: SpanContext
  name: string
  startTime: number
  endTime?: number
  status: 'unset' | 'ok' | 'error'
  attributes: Record<string, string | number | boolean>
  events: Array<{ name: string; timestamp: number; attributes?: Record<string, string> }>
  setStatus(status: 'ok' | 'error', error?: unknown): void
  setAttribute(key: string, value: string | number | boolean): void
  addEvent(name: string, attributes?: Record<string, string>): void
  end(): void
}

interface RouteMetric {
  route: string
  method: string
  count: number
  totalMs: number
  errors: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  lastCalled: number
  latencies: number[]
}

// ── State ────────────────────────────────────────────────────────────

const routeMetrics = new Map<string, RouteMetric>()
const recentSpans: Span[] = []
const MAX_RECENT_SPANS = 500
const MAX_LATENCIES = 200

let totalRequests = 0
let totalErrors = 0
const startupTime = Date.now()

// ── Span Implementation ──────────────────────────────────────────────

function generateId(bytes: number): string {
  const arr = new Uint8Array(bytes)
  // Use Math.random for lightweight hex IDs (no crypto overhead)
  for (let i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256)
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('')
}

function createSpan(name: string, parentContext?: SpanContext): Span {
  const context: SpanContext = {
    traceId: parentContext?.traceId || generateId(16),
    spanId: generateId(8),
    parentSpanId: parentContext?.spanId,
  }

  const span: Span = {
    context,
    name,
    startTime: performance.now(),
    status: 'unset',
    attributes: {},
    events: [],

    setStatus(status, error?) {
      span.status = status
      if (error instanceof Error) {
        span.attributes['error.message'] = error.message
        span.attributes['error.type'] = error.constructor.name
      }
    },

    setAttribute(key, value) {
      span.attributes[key] = value
    },

    addEvent(eventName, attributes?) {
      span.events.push({ name: eventName, timestamp: performance.now(), attributes })
    },

    end() {
      span.endTime = performance.now()
      const durationMs = span.endTime - span.startTime

      // Update metrics
      totalRequests++
      if (span.status === 'error') totalErrors++

      const key = `${span.attributes['http.method'] || 'CALL'} ${span.name}`
      let metric = routeMetrics.get(key)
      if (!metric) {
        metric = {
          route: span.name,
          method: String(span.attributes['http.method'] || 'CALL'),
          count: 0,
          totalMs: 0,
          errors: 0,
          p50Ms: 0,
          p95Ms: 0,
          p99Ms: 0,
          lastCalled: 0,
          latencies: [],
        }
        routeMetrics.set(key, metric)
      }

      metric.count++
      metric.totalMs += durationMs
      metric.lastCalled = Date.now()
      if (span.status === 'error') metric.errors++

      // Track latencies for percentile calculation (circular buffer)
      metric.latencies.push(durationMs)
      if (metric.latencies.length > MAX_LATENCIES) {
        metric.latencies = metric.latencies.slice(-MAX_LATENCIES)
      }

      // Recalculate percentiles
      const sorted = [...metric.latencies].sort((a, b) => a - b)
      metric.p50Ms = sorted[Math.floor(sorted.length * 0.50)] || 0
      metric.p95Ms = sorted[Math.floor(sorted.length * 0.95)] || 0
      metric.p99Ms = sorted[Math.floor(sorted.length * 0.99)] || 0

      // Store recent spans
      recentSpans.push(span)
      if (recentSpans.length > MAX_RECENT_SPANS) {
        recentSpans.shift()
      }

      // Structured log
      if (process.env.NODE_ENV !== 'test') {
        const log = {
          level: span.status === 'error' ? 'error' : 'info',
          msg: `${span.attributes['http.method'] || 'CALL'} ${span.name}`,
          traceId: context.traceId,
          spanId: context.spanId,
          durationMs: Math.round(durationMs * 100) / 100,
          status: span.status,
          ...(span.attributes['http.status_code'] ? { httpStatus: span.attributes['http.status_code'] } : {}),
          ...(span.status === 'error' && span.attributes['error.message'] ? { error: span.attributes['error.message'] } : {}),
        }
        if (span.status === 'error') {
          console.error(JSON.stringify(log))
        }
        // Don't log successful requests to avoid noise — enable for debugging
      }
    },
  }

  return span
}

// ── Public API ───────────────────────────────────────────────────────

export const trace = {
  /**
   * Start a new span for tracing a request or operation.
   */
  startSpan(name: string, parentContext?: SpanContext): Span {
    return createSpan(name, parentContext)
  },

  /**
   * Parse W3C traceparent header: version-traceId-parentId-flags
   */
  parseTraceparent(header: string | null): SpanContext | undefined {
    if (!header) return undefined
    const parts = header.split('-')
    if (parts.length < 4) return undefined
    return {
      traceId: parts[1],
      spanId: parts[2],
    }
  },

  /**
   * Generate W3C traceparent header
   */
  formatTraceparent(ctx: SpanContext): string {
    return `00-${ctx.traceId}-${ctx.spanId}-01`
  },
}

export const metrics = {
  /**
   * Get all route-level metrics for the admin dashboard.
   */
  getRouteMetrics(): Array<Omit<RouteMetric, 'latencies'>> {
    return Array.from(routeMetrics.values())
      .map(({ latencies, ...rest }) => rest)
      .sort((a, b) => b.count - a.count)
  },

  /**
   * Get aggregated system metrics.
   */
  getSystemMetrics() {
    const uptimeMs = Date.now() - startupTime
    const routeStats = Array.from(routeMetrics.values())
    const avgLatency = routeStats.length > 0
      ? routeStats.reduce((sum, r) => sum + (r.totalMs / r.count), 0) / routeStats.length
      : 0

    return {
      uptime_ms: uptimeMs,
      uptime_human: formatDuration(uptimeMs),
      total_requests: totalRequests,
      total_errors: totalErrors,
      error_rate: totalRequests > 0 ? Math.round((totalErrors / totalRequests) * 10000) / 100 : 0,
      routes_tracked: routeMetrics.size,
      avg_latency_ms: Math.round(avgLatency * 100) / 100,
      recent_spans: recentSpans.length,
    }
  },

  /**
   * Get recent spans for debugging.
   */
  getRecentSpans(limit = 50) {
    return recentSpans.slice(-limit).reverse().map(s => ({
      traceId: s.context.traceId,
      spanId: s.context.spanId,
      name: s.name,
      method: s.attributes['http.method'] || 'CALL',
      status: s.status,
      durationMs: s.endTime ? Math.round((s.endTime - s.startTime) * 100) / 100 : null,
      httpStatus: s.attributes['http.status_code'],
      error: s.attributes['error.message'],
      timestamp: s.startTime,
    }))
  },

  /**
   * Reset all metrics (useful for testing).
   */
  reset() {
    routeMetrics.clear()
    recentSpans.length = 0
    totalRequests = 0
    totalErrors = 0
  },
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000)
  const mins = Math.floor(secs / 60)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ${hours % 24}h ${mins % 60}m`
  if (hours > 0) return `${hours}h ${mins % 60}m ${secs % 60}s`
  if (mins > 0) return `${mins}m ${secs % 60}s`
  return `${secs}s`
}

/**
 * Convenience: wrap an entire route handler with tracing.
 *
 * Usage:
 *   export const GET = withTracing('GET /api/channels', async (req, span) => {
 *     span.setAttribute('channel_id', channelId)
 *     return NextResponse.json({ ok: true })
 *   })
 */
export function withTracing<T>(
  name: string,
  handler: (req: Request, span: Span) => Promise<T>
) {
  return async (req: Request): Promise<T> => {
    const parentCtx = trace.parseTraceparent(req.headers.get('traceparent'))
    const span = trace.startSpan(name, parentCtx)
    span.setAttribute('http.method', req.method)

    try {
      const result = await handler(req, span)
      span.setStatus('ok')

      // Try to extract status code from Response
      if (result && typeof result === 'object' && 'status' in result) {
        span.setAttribute('http.status_code', (result as { status: number }).status)
      }

      return result
    } catch (err: unknown) {
      span.setStatus('error', err)
      throw err
    } finally {
      span.end()
    }
  }
}
