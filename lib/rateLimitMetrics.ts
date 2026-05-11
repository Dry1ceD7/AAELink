/**
 * AAELink Rate Limit Metrics Collector
 *
 * Extends the in-process rate limiter with observable metrics:
 *   - Total requests per route/key
 *   - Blocked requests (429s) per route/key
 *   - Current window utilization
 *   - Per-IP tracking for abuse detection
 *
 * Metrics are held in-memory and exposed via getMetrics() for
 * the admin dashboard and Prometheus /metrics endpoint.
 */

// ── Types ────────────────────────────────────────────────────────────

export interface RateLimitMetric {
  key: string
  route: string
  totalRequests: number
  blockedRequests: number
  lastRequestAt: number
  windowUtilization: number  // 0.0 – 1.0
}

interface MetricEntry {
  route: string
  total: number
  blocked: number
  lastAt: number
  limit: number
  windowMs: number
  windowStart: number
  windowCount: number
}

// ── Collector ────────────────────────────────────────────────────────

class RateLimitMetrics {
  private entries = new Map<string, MetricEntry>()
  private sweepTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    // Sweep stale entries every 5 min
    this.sweepTimer = setInterval(() => this.sweep(), 300_000)
    if (this.sweepTimer.unref) this.sweepTimer.unref()
  }

  /** Record a request (allowed or blocked) */
  record(key: string, route: string, allowed: boolean, limit: number, windowMs: number): void {
    const now = Date.now()
    let entry = this.entries.get(key)

    if (!entry) {
      entry = {
        route,
        total: 0,
        blocked: 0,
        lastAt: 0,
        limit,
        windowMs,
        windowStart: now,
        windowCount: 0,
      }
      this.entries.set(key, entry)
    }

    entry.total++
    entry.lastAt = now
    if (!allowed) entry.blocked++

    // Track window utilization
    if (now - entry.windowStart > entry.windowMs) {
      entry.windowStart = now
      entry.windowCount = 1
    } else {
      entry.windowCount++
    }
  }

  /** Get all metrics as a snapshot */
  getMetrics(): RateLimitMetric[] {
    const result: RateLimitMetric[] = []
    for (const [key, entry] of this.entries) {
      result.push({
        key,
        route: entry.route,
        totalRequests: entry.total,
        blockedRequests: entry.blocked,
        lastRequestAt: entry.lastAt,
        windowUtilization: entry.limit > 0 ? entry.windowCount / entry.limit : 0,
      })
    }
    return result.sort((a, b) => b.totalRequests - a.totalRequests)
  }

  /** Get metrics aggregated by route */
  getRouteMetrics(): Array<{
    route: string
    totalRequests: number
    blockedRequests: number
    uniqueKeys: number
    blockRate: number
  }> {
    const byRoute = new Map<string, { total: number; blocked: number; keys: Set<string> }>()
    for (const [key, entry] of this.entries) {
      let agg = byRoute.get(entry.route)
      if (!agg) {
        agg = { total: 0, blocked: 0, keys: new Set() }
        byRoute.set(entry.route, agg)
      }
      agg.total += entry.total
      agg.blocked += entry.blocked
      agg.keys.add(key)
    }

    return Array.from(byRoute.entries())
      .map(([route, agg]) => ({
        route,
        totalRequests: agg.total,
        blockedRequests: agg.blocked,
        uniqueKeys: agg.keys.size,
        blockRate: agg.total > 0 ? agg.blocked / agg.total : 0,
      }))
      .sort((a, b) => b.totalRequests - a.totalRequests)
  }

  /** Get top offenders (highest block rate) */
  getTopOffenders(limit = 10): RateLimitMetric[] {
    return this.getMetrics()
      .filter(m => m.blockedRequests > 0)
      .sort((a, b) => b.blockedRequests - a.blockedRequests)
      .slice(0, limit)
  }

  /** Export in Prometheus exposition format */
  toPrometheus(): string {
    const lines: string[] = [
      '# HELP aaelink_ratelimit_total Total requests tracked by rate limiter',
      '# TYPE aaelink_ratelimit_total counter',
      '# HELP aaelink_ratelimit_blocked Blocked requests (429)',
      '# TYPE aaelink_ratelimit_blocked counter',
      '# HELP aaelink_ratelimit_utilization Current window utilization ratio',
      '# TYPE aaelink_ratelimit_utilization gauge',
    ]

    for (const m of this.getMetrics()) {
      const labels = `route="${m.route}",key="${m.key}"`
      lines.push(`aaelink_ratelimit_total{${labels}} ${m.totalRequests}`)
      lines.push(`aaelink_ratelimit_blocked{${labels}} ${m.blockedRequests}`)
      lines.push(`aaelink_ratelimit_utilization{${labels}} ${m.windowUtilization.toFixed(4)}`)
    }
    return lines.join('\n') + '\n'
  }

  /** Reset all metrics */
  reset(): void {
    this.entries.clear()
  }

  private sweep(): void {
    const cutoff = Date.now() - 3600_000  // remove entries older than 1h
    for (const [key, entry] of this.entries) {
      if (entry.lastAt < cutoff) this.entries.delete(key)
    }
  }

  /** Clean up timer */
  destroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = null
    }
  }
}

// ── Singleton ────────────────────────────────────────────────────────

let _metrics: RateLimitMetrics | null = null

export function getRateLimitMetrics(): RateLimitMetrics {
  if (!_metrics) _metrics = new RateLimitMetrics()
  return _metrics
}

export { RateLimitMetrics }
