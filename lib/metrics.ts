/**
 * Lightweight Prometheus-compatible metrics registry.
 *
 * No external dependencies — implements counters, gauges, and histograms
 * using plain Maps. Exposes a `serialize()` function that outputs
 * Prometheus text format for scraping via `/api/metrics`.
 *
 * Usage:
 *   import { httpRequests, httpLatency, activeSSE, gaugeSet } from '@/lib/metrics'
 *   httpRequests.inc({ method: 'GET', route: '/api/channels', status: '200' })
 *   httpLatency.observe({ route: '/api/messages' }, durationMs)
 *   activeSSE.inc()
 */

// ── Counter ──────────────────────────────────────────────────────────

type Labels = Record<string, string>

function labelsKey(labels: Labels): string {
  return Object.entries(labels).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`).join(',')
}

class Counter {
  readonly name: string
  readonly help: string
  private data = new Map<string, number>()

  constructor(name: string, help: string) { this.name = name; this.help = help }

  inc(labels: Labels = {}, value = 1) {
    const key = labelsKey(labels)
    this.data.set(key, (this.data.get(key) || 0) + value)
  }

  serialize(): string {
    const lines: string[] = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`]
    for (const [key, val] of this.data) {
      lines.push(key ? `${this.name}{${key}} ${val}` : `${this.name} ${val}`)
    }
    return lines.join('\n')
  }
}

// ── Gauge ────────────────────────────────────────────────────────────

class Gauge {
  readonly name: string
  readonly help: string
  private data = new Map<string, number>()

  constructor(name: string, help: string) { this.name = name; this.help = help }

  set(labels: Labels, value: number) { this.data.set(labelsKey(labels), value) }
  inc(labels: Labels = {}, value = 1) {
    const key = labelsKey(labels)
    this.data.set(key, (this.data.get(key) || 0) + value)
  }
  dec(labels: Labels = {}, value = 1) { this.inc(labels, -value) }

  serialize(): string {
    const lines: string[] = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`]
    for (const [key, val] of this.data) {
      lines.push(key ? `${this.name}{${key}} ${val}` : `${this.name} ${val}`)
    }
    return lines.join('\n')
  }
}

// ── Histogram ────────────────────────────────────────────────────────

class Histogram {
  readonly name: string
  readonly help: string
  readonly buckets: number[]
  private data = new Map<string, { buckets: number[]; sum: number; count: number }>()

  constructor(name: string, help: string, buckets?: number[]) {
    this.name = name
    this.help = help
    this.buckets = buckets || [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]
  }

  observe(labels: Labels, value: number) {
    const key = labelsKey(labels)
    let entry = this.data.get(key)
    if (!entry) {
      entry = { buckets: new Array(this.buckets.length).fill(0), sum: 0, count: 0 }
      this.data.set(key, entry)
    }
    entry.sum += value
    entry.count++
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) entry.buckets[i]++
    }
  }

  serialize(): string {
    const lines: string[] = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`]
    for (const [key, entry] of this.data) {
      const prefix = key ? `{${key},` : '{'
      for (let i = 0; i < this.buckets.length; i++) {
        lines.push(`${this.name}_bucket${prefix}le="${this.buckets[i]}"} ${entry.buckets[i]}`)
      }
      lines.push(`${this.name}_bucket${prefix}le="+Inf"} ${entry.count}`)
      lines.push(`${this.name}_sum${key ? `{${key}}` : ''} ${entry.sum}`)
      lines.push(`${this.name}_count${key ? `{${key}}` : ''} ${entry.count}`)
    }
    return lines.join('\n')
  }
}

// ── Pre-defined metrics ──────────────────────────────────────────────

/** Total HTTP requests by method, route, status */
export const httpRequests = new Counter(
  'aaelink_http_requests_total',
  'Total HTTP requests'
)

/** HTTP request duration in milliseconds */
export const httpLatency = new Histogram(
  'aaelink_http_duration_ms',
  'HTTP request duration in milliseconds',
  [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]
)

/** Active SSE connections */
export const activeSSE = new Gauge(
  'aaelink_sse_connections_active',
  'Currently active SSE connections'
)

/** Messages sent (counter) */
export const messagesSent = new Counter(
  'aaelink_messages_sent_total',
  'Total messages sent'
)

/** Active call rooms */
export const activeCallRooms = new Gauge(
  'aaelink_call_rooms_active',
  'Currently active call rooms'
)

/** Job queue depth by type */
export const jobQueueDepth = new Gauge(
  'aaelink_job_queue_depth',
  'Number of pending jobs by type'
)

/** Job processing duration */
export const jobDuration = new Histogram(
  'aaelink_job_duration_ms',
  'Job processing duration in milliseconds',
  [100, 500, 1000, 5000, 10000, 30000, 60000]
)

/** DLP violations detected */
export const dlpViolations = new Counter(
  'aaelink_dlp_violations_total',
  'DLP rule violations detected'
)

/** Push notifications sent */
export const pushNotificationsSent = new Counter(
  'aaelink_push_notifications_sent_total',
  'Push notifications queued for delivery'
)

/** Webhook delivery attempts */
export const webhookDeliveries = new Counter(
  'aaelink_webhook_deliveries_total',
  'Webhook delivery attempts by status'
)

/** Auth events (login, logout, mfa, sso) */
export const authEvents = new Counter(
  'aaelink_auth_events_total',
  'Authentication events by type'
)

/** File uploads */
export const fileUploads = new Counter(
  'aaelink_file_uploads_total',
  'Files uploaded'
)

/** Database connection pool */
export const dbPoolActive = new Gauge(
  'aaelink_db_pool_active',
  'Active database connections'
)

export const dbPoolIdle = new Gauge(
  'aaelink_db_pool_idle',
  'Idle database connections'
)

// ── Registry ─────────────────────────────────────────────────────────

const allMetrics = [
  httpRequests, httpLatency, activeSSE, messagesSent, activeCallRooms,
  jobQueueDepth, jobDuration, dlpViolations, pushNotificationsSent,
  webhookDeliveries, authEvents, fileUploads, dbPoolActive, dbPoolIdle,
]

/** Process-level metrics */
function processMetrics(): string {
  const mem = process.memoryUsage()
  const lines = [
    '# HELP aaelink_process_heap_bytes Process heap usage in bytes',
    '# TYPE aaelink_process_heap_bytes gauge',
    `aaelink_process_heap_bytes ${mem.heapUsed}`,
    '# HELP aaelink_process_rss_bytes Process RSS in bytes',
    '# TYPE aaelink_process_rss_bytes gauge',
    `aaelink_process_rss_bytes ${mem.rss}`,
    '# HELP aaelink_process_uptime_seconds Process uptime in seconds',
    '# TYPE aaelink_process_uptime_seconds gauge',
    `aaelink_process_uptime_seconds ${Math.floor(process.uptime())}`,
  ]
  return lines.join('\n')
}

/** Serialize all metrics to Prometheus text exposition format */
export function serializeMetrics(): string {
  const sections = allMetrics.map(m => m.serialize()).filter(s => s.includes('}') || s.includes(' '))
  sections.push(processMetrics())
  return sections.join('\n\n') + '\n'
}

/** Track request timing — call at start, returns a finish function */
export function startRequestTimer(method: string, route: string) {
  const start = performance.now()
  return (status: number) => {
    const duration = performance.now() - start
    httpRequests.inc({ method, route, status: String(status) })
    httpLatency.observe({ route }, duration)
  }
}
