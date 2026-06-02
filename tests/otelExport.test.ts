/**
 * AAELink — OpenTelemetry Export Tests
 *
 * Validates span buffering, batch flushing, OTLP conversion,
 * sampling, and shutdown.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SpanBuffer, type OtelSpan, type ExportResult } from '@/lib/infra/otelExport'

function makeSpan(overrides: Partial<OtelSpan> = {}): OtelSpan {
  return {
    traceId: 'abcdef1234567890abcdef1234567890',
    spanId: '1234567890abcdef',
    name: 'GET /api/test',
    kind: 'SERVER',
    startTimeUnixNano: Date.now() * 1_000_000,
    endTimeUnixNano: (Date.now() + 50) * 1_000_000,
    attributes: {
      'http.method': 'GET',
      'http.route': '/api/test',
      'http.status_code': 200,
      'http.response_time_ms': 50,
    },
    status: { code: 0 },
    resource: {
      'service.name': 'aaelink',
      'service.version': '0.0.14',
      'deployment.environment': 'test',
    },
    ...overrides,
  }
}

describe('OTEL Export — SpanBuffer', () => {
  let exported: OtelSpan[]
  let buffer: SpanBuffer

  beforeEach(() => {
    exported = []
    buffer = new SpanBuffer({ exporter: 'none' }, async (spans) => {
      exported.push(...spans)
      return { success: true, spansExported: spans.length }
    })
  })

  it('buffers spans', () => {
    buffer.addSpan(makeSpan())
    buffer.addSpan(makeSpan())
    expect(buffer.getStats().buffered).toBe(2)
  })

  it('flushes spans to exporter', async () => {
    buffer.addSpan(makeSpan())
    buffer.addSpan(makeSpan())
    const result = await buffer.flush()
    expect(result.success).toBe(true)
    expect(result.spansExported).toBe(2)
    expect(exported).toHaveLength(2)
    expect(buffer.getStats().buffered).toBe(0)
  })

  it('returns empty flush when no spans', async () => {
    const result = await buffer.flush()
    expect(result.success).toBe(true)
    expect(result.spansExported).toBe(0)
  })

  it('auto-flushes when batch is full', async () => {
    const smallBatch = new SpanBuffer(
      { exporter: 'none', maxBatchSize: 3 },
      async (spans) => {
        exported.push(...spans)
        return { success: true, spansExported: spans.length }
      },
    )
    smallBatch.addSpan(makeSpan())
    smallBatch.addSpan(makeSpan())
    smallBatch.addSpan(makeSpan())
    // Wait for async flush
    await new Promise(r => setTimeout(r, 10))
    expect(exported.length).toBeGreaterThanOrEqual(3)
  })

  it('requeues on export failure', async () => {
    let failOnce = true
    const failBuffer = new SpanBuffer({ exporter: 'none' }, async (spans) => {
      if (failOnce) {
        failOnce = false
        throw new Error('network error')
      }
      return { success: true, spansExported: spans.length }
    })

    failBuffer.addSpan(makeSpan())
    const r1 = await failBuffer.flush()
    expect(r1.success).toBe(false)
    expect(failBuffer.getStats().buffered).toBe(1) // re-queued

    const r2 = await failBuffer.flush()
    expect(r2.success).toBe(true)
    expect(failBuffer.getStats().buffered).toBe(0)
  })

  it('samples spans based on rate', () => {
    const sampledBuffer = new SpanBuffer(
      { exporter: 'none', sampleRate: 0.0 },
      async () => ({ success: true, spansExported: 0 }),
    )
    for (let i = 0; i < 100; i++) sampledBuffer.addSpan(makeSpan())
    expect(sampledBuffer.getStats().buffered).toBe(0) // all dropped
  })

  it('converts trace metrics to OTLP spans', () => {
    const span = buffer.fromTraceMetric({
      traceId: 'abc123',
      spanId: 'def456',
      method: 'POST',
      route: '/api/messages',
      statusCode: 201,
      durationMs: 42,
      startTime: 1700000000000,
    })

    expect(span.name).toBe('POST /api/messages')
    expect(span.kind).toBe('SERVER')
    expect(span.attributes['http.method']).toBe('POST')
    expect(span.attributes['http.status_code']).toBe(201)
    expect(span.status.code).toBe(0) // OK
  })

  it('marks error spans', () => {
    const span = buffer.fromTraceMetric({
      traceId: 'abc123',
      spanId: 'def456',
      method: 'GET',
      route: '/api/test',
      statusCode: 500,
      durationMs: 100,
      startTime: 1700000000000,
      error: 'Internal Server Error',
    })

    expect(span.status.code).toBe(2) // ERROR
    expect(span.attributes['error.message']).toBe('Internal Server Error')
  })

  it('shuts down gracefully', async () => {
    buffer.addSpan(makeSpan())
    buffer.startAutoFlush()
    const result = await buffer.shutdown()
    expect(result.success).toBe(true)
    expect(result.spansExported).toBe(1)
    expect(buffer.getStats().buffered).toBe(0)
  })

  it('drops oldest spans when queue is full', () => {
    const tinyQueue = new SpanBuffer(
      { exporter: 'none', maxQueueSize: 5, maxBatchSize: 100 },
      async () => ({ success: true, spansExported: 0 }),
    )
    for (let i = 0; i < 10; i++) {
      tinyQueue.addSpan(makeSpan({ spanId: `span_${i}` }))
    }
    expect(tinyQueue.getStats().buffered).toBeLessThanOrEqual(5)
  })
})

describe('OTEL Export — Console Exporter', () => {
  it('logs spans to console', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const consoleBuf = new SpanBuffer({ exporter: 'console' })
    consoleBuf.addSpan(makeSpan())
    await consoleBuf.flush()
    expect(logSpy).toHaveBeenCalledOnce()
    expect(logSpy.mock.calls[0]?.[0]).toContain('[OTEL]')
    logSpy.mockRestore()
  })
})
