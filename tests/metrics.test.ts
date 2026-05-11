/**
 * AAELink — Metrics Registry Tests
 */
import { describe, it, expect } from 'vitest'
import {
  httpRequests, httpLatency, activeSSE, messagesSent,
  serializeMetrics, startRequestTimer,
} from '@/lib/metrics'

describe('Metrics — Counter', () => {
  it('increments counter', () => {
    httpRequests.inc({ method: 'GET', route: '/test-counter', status: '200' })
    const s = httpRequests.serialize()
    expect(s).toContain('aaelink_http_requests_total')
    expect(s).toContain('counter')
  })

  it('counter shows labels', () => {
    messagesSent.inc({ channel: 'ch-1' })
    const s = messagesSent.serialize()
    expect(s).toContain('channel="ch-1"')
  })
})

describe('Metrics — Gauge', () => {
  it('inc and dec', () => {
    activeSSE.inc()
    activeSSE.inc()
    activeSSE.dec()
    const s = activeSSE.serialize()
    expect(s).toContain('gauge')
  })
})

describe('Metrics — Histogram', () => {
  it('records observation', () => {
    httpLatency.observe({ route: '/test-histo' }, 42)
    const s = httpLatency.serialize()
    expect(s).toContain('histogram')
    expect(s).toContain('_bucket')
    expect(s).toContain('_sum')
    expect(s).toContain('_count')
  })
})

describe('Metrics — serializeMetrics', () => {
  it('produces Prometheus text format', () => {
    const output = serializeMetrics()
    expect(output).toContain('# HELP')
    expect(output).toContain('# TYPE')
    expect(output).toContain('aaelink_process_heap_bytes')
    expect(output).toContain('aaelink_process_uptime_seconds')
  })
})

describe('Metrics — startRequestTimer', () => {
  it('records timing on finish', () => {
    const finish = startRequestTimer('POST', '/api/timer-test')
    finish(201)
    // No error means it worked
    const s = httpRequests.serialize()
    expect(s).toContain('/api/timer-test')
  })
})
