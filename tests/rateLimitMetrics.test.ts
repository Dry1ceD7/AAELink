/**
 * AAELink — Rate Limit Metrics Tests
 *
 * Validates metrics collection, route aggregation, top offenders,
 * and Prometheus export.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { RateLimitMetrics } from '@/lib/api/rateLimitMetrics'

describe('Rate Limit Metrics', () => {
  let metrics: RateLimitMetrics

  beforeEach(() => {
    metrics = new RateLimitMetrics()
  })

  it('records allowed requests', () => {
    metrics.record('user-1:/api/chat', '/api/chat', true, 10, 5000)
    metrics.record('user-1:/api/chat', '/api/chat', true, 10, 5000)
    const all = metrics.getMetrics()
    expect(all).toHaveLength(1)
    expect(all[0].totalRequests).toBe(2)
    expect(all[0].blockedRequests).toBe(0)
    expect(all[0].route).toBe('/api/chat')
  })

  it('records blocked requests', () => {
    metrics.record('user-1:/api/chat', '/api/chat', true, 10, 5000)
    metrics.record('user-1:/api/chat', '/api/chat', false, 10, 5000)
    const all = metrics.getMetrics()
    expect(all[0].totalRequests).toBe(2)
    expect(all[0].blockedRequests).toBe(1)
  })

  it('tracks multiple keys independently', () => {
    metrics.record('user-1:/api/chat', '/api/chat', true, 10, 5000)
    metrics.record('user-2:/api/chat', '/api/chat', true, 10, 5000)
    expect(metrics.getMetrics()).toHaveLength(2)
  })

  it('aggregates by route correctly', () => {
    metrics.record('user-1:/api/chat', '/api/chat', true, 10, 5000)
    metrics.record('user-2:/api/chat', '/api/chat', false, 10, 5000)
    metrics.record('user-1:/api/files', '/api/files', true, 10, 5000)

    const routes = metrics.getRouteMetrics()
    expect(routes).toHaveLength(2)
    const chatRoute = routes.find(r => r.route === '/api/chat')
    expect(chatRoute!.totalRequests).toBe(2)
    expect(chatRoute!.blockedRequests).toBe(1)
    expect(chatRoute!.uniqueKeys).toBe(2)
    expect(chatRoute!.blockRate).toBeCloseTo(0.5)
  })

  it('returns top offenders sorted by blocked count', () => {
    metrics.record('abuser:/api/chat', '/api/chat', false, 10, 5000)
    metrics.record('abuser:/api/chat', '/api/chat', false, 10, 5000)
    metrics.record('abuser:/api/chat', '/api/chat', false, 10, 5000)
    metrics.record('normal:/api/chat', '/api/chat', false, 10, 5000)
    metrics.record('good:/api/chat', '/api/chat', true, 10, 5000)

    const offenders = metrics.getTopOffenders(5)
    expect(offenders).toHaveLength(2) // only those with blocks
    expect(offenders[0].key).toBe('abuser:/api/chat')
    expect(offenders[0].blockedRequests).toBe(3)
  })

  it('calculates window utilization', () => {
    // 5 requests out of limit=10 → 0.5 utilization
    for (let i = 0; i < 5; i++) {
      metrics.record('user-1:/api/chat', '/api/chat', true, 10, 5000)
    }
    const m = metrics.getMetrics()
    expect(m[0].windowUtilization).toBeCloseTo(0.5)
  })

  it('exports Prometheus format', () => {
    metrics.record('user-1:/api/chat', '/api/chat', true, 10, 5000)
    metrics.record('user-1:/api/chat', '/api/chat', false, 10, 5000)
    const prom = metrics.toPrometheus()
    expect(prom).toContain('# HELP aaelink_ratelimit_total')
    expect(prom).toContain('# TYPE aaelink_ratelimit_total counter')
    expect(prom).toContain('aaelink_ratelimit_total{route="/api/chat"')
    expect(prom).toContain('aaelink_ratelimit_blocked{route="/api/chat"')
    expect(prom).toContain('aaelink_ratelimit_utilization{route="/api/chat"')
  })

  it('reset clears all metrics', () => {
    metrics.record('user-1:/api/chat', '/api/chat', true, 10, 5000)
    expect(metrics.getMetrics()).toHaveLength(1)
    metrics.reset()
    expect(metrics.getMetrics()).toHaveLength(0)
  })

  it('destroy cleans up timer', () => {
    // Should not throw
    metrics.destroy()
    metrics.destroy() // double destroy should be safe
  })
})
