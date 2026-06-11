/**
 * Unit tests for lib/tracing.ts — AAELink observability module
 *
 * Tests: span lifecycle, metrics aggregation, percentile calculation,
 *        W3C traceparent parsing, and withTracing wrapper.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { trace, metrics, withTracing } from '@/lib/infra/tracing'

describe('Tracing Module', () => {
  beforeEach(() => {
    metrics.reset()
  })

  describe('Span lifecycle', () => {
    it('creates a span with unique trace and span IDs', () => {
      const span = trace.startSpan('/api/channels')
      expect(span.context.traceId).toBeTruthy()
      expect(span.context.spanId).toBeTruthy()
      expect(span.context.traceId).toHaveLength(32)
      expect(span.context.spanId).toHaveLength(16)
      expect(span.status).toBe('unset')
      span.end()
    })

    it('records duration on end()', () => {
      const span = trace.startSpan('/api/test')
      span.setStatus('ok')
      span.end()
      expect(span.endTime).toBeGreaterThan(span.startTime)
    })

    it('tracks attributes', () => {
      const span = trace.startSpan('/api/users')
      span.setAttribute('http.method', 'GET')
      span.setAttribute('http.status_code', 200)
      expect(span.attributes['http.method']).toBe('GET')
      expect(span.attributes['http.status_code']).toBe(200)
      span.end()
    })

    it('captures error info from Error objects', () => {
      const span = trace.startSpan('/api/failing')
      span.setStatus('error', new TypeError('null ref'))
      expect(span.status).toBe('error')
      expect(span.attributes['error.message']).toBe('null ref')
      expect(span.attributes['error.type']).toBe('TypeError')
      span.end()
    })

    it('records events', () => {
      const span = trace.startSpan('/api/process')
      span.addEvent('db_query', { table: 'users' })
      expect(span.events).toHaveLength(1)
      expect(span.events[0].name).toBe('db_query')
      span.end()
    })
  })

  describe('Metrics aggregation', () => {
    it('increments total request count', () => {
      const s1 = trace.startSpan('/api/a')
      s1.setAttribute('http.method', 'GET')
      s1.setStatus('ok')
      s1.end()

      const s2 = trace.startSpan('/api/b')
      s2.setAttribute('http.method', 'POST')
      s2.setStatus('ok')
      s2.end()

      const sys = metrics.getSystemMetrics()
      expect(sys.total_requests).toBe(2)
      expect(sys.total_errors).toBe(0)
    })

    it('tracks error counts', () => {
      const s1 = trace.startSpan('/api/fail')
      s1.setAttribute('http.method', 'POST')
      s1.setStatus('error')
      s1.end()

      const sys = metrics.getSystemMetrics()
      expect(sys.total_errors).toBe(1)
      expect(sys.error_rate).toBeGreaterThan(0)
    })

    it('groups metrics by route', () => {
      for (let i = 0; i < 5; i++) {
        const s = trace.startSpan('/api/channels')
        s.setAttribute('http.method', 'GET')
        s.setStatus('ok')
        s.end()
      }

      const routes = metrics.getRouteMetrics()
      expect(routes.length).toBe(1)
      expect(routes[0].count).toBe(5)
      expect(routes[0].route).toBe('/api/channels')
    })

    it('calculates percentiles', () => {
      // Fire enough spans to have meaningful percentiles
      for (let i = 0; i < 20; i++) {
        const s = trace.startSpan('/api/latency')
        s.setAttribute('http.method', 'GET')
        s.setStatus('ok')
        s.end()
      }

      const routes = metrics.getRouteMetrics()
      const r = routes.find(r => r.route === '/api/latency')
      expect(r).toBeTruthy()
      expect(r!.p50Ms).toBeGreaterThanOrEqual(0)
      expect(r!.p95Ms).toBeGreaterThanOrEqual(r!.p50Ms)
      expect(r!.p99Ms).toBeGreaterThanOrEqual(r!.p95Ms)
    })
  })

  describe('Recent spans', () => {
    it('stores recent spans in reverse chronological order', () => {
      const s1 = trace.startSpan('/api/first')
      s1.setStatus('ok')
      s1.end()

      const s2 = trace.startSpan('/api/second')
      s2.setStatus('ok')
      s2.end()

      const recent = metrics.getRecentSpans(10)
      expect(recent.length).toBe(2)
      expect(recent[0].name).toBe('/api/second')
      expect(recent[1].name).toBe('/api/first')
    })

    it('limits returned spans', () => {
      for (let i = 0; i < 10; i++) {
        const s = trace.startSpan(`/api/route-${i}`)
        s.setStatus('ok')
        s.end()
      }

      const recent = metrics.getRecentSpans(3)
      expect(recent.length).toBe(3)
    })
  })

  describe('W3C Traceparent', () => {
    it('parses valid traceparent header', () => {
      const ctx = trace.parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')
      expect(ctx).toBeTruthy()
      expect(ctx!.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
      expect(ctx!.spanId).toBe('00f067aa0ba902b7')
    })

    it('returns undefined for null header', () => {
      expect(trace.parseTraceparent(null)).toBeUndefined()
    })

    it('returns undefined for malformed header', () => {
      expect(trace.parseTraceparent('invalid')).toBeUndefined()
    })

    it('formats traceparent header', () => {
      const header = trace.formatTraceparent({ traceId: 'abcdef01234567890abcdef012345678', spanId: '0123456789abcdef' })
      expect(header).toBe('00-abcdef01234567890abcdef012345678-0123456789abcdef-01')
    })

    it('propagates parent context to child spans', () => {
      const parentCtx = trace.parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')
      const child = trace.startSpan('/api/child', parentCtx)
      expect(child.context.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
      expect(child.context.parentSpanId).toBe('00f067aa0ba902b7')
      expect(child.context.spanId).not.toBe('00f067aa0ba902b7') // should be new
      child.end()
    })
  })

  describe('System metrics', () => {
    it('reports uptime', () => {
      const sys = metrics.getSystemMetrics()
      expect(sys.uptime_ms).toBeGreaterThan(0)
      expect(sys.uptime_human).toBeTruthy()
    })

    it('resets cleanly', () => {
      const s = trace.startSpan('/api/before-reset')
      s.setStatus('ok')
      s.end()

      metrics.reset()
      const sys = metrics.getSystemMetrics()
      expect(sys.total_requests).toBe(0)
      expect(sys.routes_tracked).toBe(0)
      expect(metrics.getRecentSpans()).toHaveLength(0)
    })
  })
})
