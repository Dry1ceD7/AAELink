/**
 * AAELink OpenTelemetry Export Module
 *
 * Bridges the internal tracing system (`lib/tracedRoute.ts`) to
 * standard OpenTelemetry OTLP exporters for production observability.
 *
 * Supports:
 *   - OTLP/gRPC export (Jaeger, Tempo, Collector)
 *   - OTLP/HTTP export (Grafana Cloud, Honeycomb, Datadog)
 *   - Console export (development)
 *   - Batch span processing with configurable flush intervals
 *   - Resource attributes (service name, version, environment)
 *   - W3C Trace Context propagation
 */

// ── Types ────────────────────────────────────────────────────────────

export type OtelExporterType = 'console' | 'otlp-grpc' | 'otlp-http' | 'none'

export interface OtelConfig {
  /** Service name reported to collectors */
  serviceName: string
  /** Service version */
  serviceVersion: string
  /** Deployment environment */
  environment: string
  /** Exporter type */
  exporter: OtelExporterType
  /** OTLP endpoint (gRPC or HTTP) */
  endpoint: string
  /** Optional auth headers */
  headers: Record<string, string>
  /** Batch flush interval in ms */
  batchFlushMs: number
  /** Max batch size */
  maxBatchSize: number
  /** Max queue size */
  maxQueueSize: number
  /** Whether to sample all traces (1.0) or a fraction */
  sampleRate: number
}

export interface OtelSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: 'SERVER' | 'CLIENT' | 'INTERNAL'
  startTimeUnixNano: number
  endTimeUnixNano: number
  attributes: Record<string, string | number | boolean>
  status: { code: number; message?: string }
  resource: Record<string, string>
}

export interface ExportResult {
  success: boolean
  spansExported: number
  error?: string
}

// ── Defaults ─────────────────────────────────────────────────────────

export const DEFAULT_OTEL_CONFIG: OtelConfig = {
  serviceName: 'aaelink',
  serviceVersion: '0.0.14',
  environment: process.env.NODE_ENV || 'development',
  exporter: 'console',
  endpoint: 'http://localhost:4317',
  headers: {},
  batchFlushMs: 5000,
  maxBatchSize: 512,
  maxQueueSize: 2048,
  sampleRate: 1.0,
}

// ── Span Buffer ──────────────────────────────────────────────────────

export class SpanBuffer {
  private buffer: OtelSpan[] = []
  private config: OtelConfig
  private timer: ReturnType<typeof setInterval> | null = null
  private exportFn: (spans: OtelSpan[]) => Promise<ExportResult>

  constructor(
    config: Partial<OtelConfig> = {},
    exportFn?: (spans: OtelSpan[]) => Promise<ExportResult>,
  ) {
    this.config = { ...DEFAULT_OTEL_CONFIG, ...config }
    this.exportFn = exportFn || this.defaultExport.bind(this)
  }

  /** Add a span to the buffer */
  addSpan(span: OtelSpan): void {
    // Sampling
    if (this.config.sampleRate < 1.0 && Math.random() > this.config.sampleRate) {
      return
    }

    this.buffer.push(span)

    // Flush if buffer is full
    if (this.buffer.length >= this.config.maxBatchSize) {
      void this.flush()
    }

    // Drop oldest if queue is full
    if (this.buffer.length > this.config.maxQueueSize) {
      this.buffer = this.buffer.slice(-this.config.maxQueueSize)
    }
  }

  /** Convert a tracedRoute metric to an OtelSpan */
  fromTraceMetric(metric: {
    traceId: string
    spanId: string
    method: string
    route: string
    statusCode: number
    durationMs: number
    startTime: number
    error?: string
  }): OtelSpan {
    const startNano = metric.startTime * 1_000_000
    const endNano = startNano + (metric.durationMs * 1_000_000)

    return {
      traceId: metric.traceId,
      spanId: metric.spanId,
      name: `${metric.method} ${metric.route}`,
      kind: 'SERVER',
      startTimeUnixNano: startNano,
      endTimeUnixNano: endNano,
      attributes: {
        'http.method': metric.method,
        'http.route': metric.route,
        'http.status_code': metric.statusCode,
        'http.response_time_ms': metric.durationMs,
        ...(metric.error ? { 'error.message': metric.error } : {}),
      },
      status: {
        code: metric.statusCode >= 400 ? 2 : 0, // ERROR = 2, OK = 0
        message: metric.error,
      },
      resource: {
        'service.name': this.config.serviceName,
        'service.version': this.config.serviceVersion,
        'deployment.environment': this.config.environment,
      },
    }
  }

  /** Flush buffered spans to the exporter */
  async flush(): Promise<ExportResult> {
    if (this.buffer.length === 0) {
      return { success: true, spansExported: 0 }
    }

    const batch = this.buffer.splice(0, this.config.maxBatchSize)
    try {
      return await this.exportFn(batch)
    } catch (err: unknown) {
      // Put spans back on failure
      this.buffer.unshift(...batch)
      return { success: false, spansExported: 0, error: String(err) }
    }
  }

  /** Start periodic flushing */
  startAutoFlush(): void {
    this.stopAutoFlush()
    this.timer = setInterval(() => void this.flush(), this.config.batchFlushMs)
  }

  /** Stop periodic flushing */
  stopAutoFlush(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Graceful shutdown — flush remaining and stop */
  async shutdown(): Promise<ExportResult> {
    this.stopAutoFlush()
    return this.flush()
  }

  /** Get buffer stats */
  getStats(): { buffered: number; config: OtelConfig } {
    return { buffered: this.buffer.length, config: { ...this.config } }
  }

  /** Default console exporter */
  private async defaultExport(spans: OtelSpan[]): Promise<ExportResult> {
    if (this.config.exporter === 'none') {
      return { success: true, spansExported: spans.length }
    }

    if (this.config.exporter === 'console') {
      for (const span of spans) {
        const attrs = span.attributes
        const status = attrs['http.status_code'] || ''
        const dur = attrs['http.response_time_ms'] || ''
        console.log(
          `[OTEL] ${span.name} ${status} ${dur}ms trace=${span.traceId.slice(0, 8)}`
        )
      }
      return { success: true, spansExported: spans.length }
    }

    if (this.config.exporter === 'otlp-http') {
      return this.exportOtlpHttp(spans)
    }

    // otlp-grpc would require @opentelemetry/exporter-trace-otlp-grpc
    // For now, fall back to HTTP
    if (this.config.exporter === 'otlp-grpc') {
      return this.exportOtlpHttp(spans)
    }

    return { success: false, spansExported: 0, error: `unknown exporter: ${this.config.exporter}` }
  }

  /** OTLP/HTTP export (JSON protocol) */
  private async exportOtlpHttp(spans: OtelSpan[]): Promise<ExportResult> {
    const endpoint = this.config.endpoint.replace(/\/$/, '') + '/v1/traces'

    const payload = {
      resourceSpans: [{
        resource: {
          attributes: Object.entries(spans[0]?.resource || {}).map(([k, v]) => ({
            key: k,
            value: { stringValue: String(v) },
          })),
        },
        scopeSpans: [{
          scope: { name: 'aaelink-tracing', version: this.config.serviceVersion },
          spans: spans.map(s => ({
            traceId: s.traceId,
            spanId: s.spanId,
            parentSpanId: s.parentSpanId || '',
            name: s.name,
            kind: s.kind === 'SERVER' ? 2 : s.kind === 'CLIENT' ? 3 : 1,
            startTimeUnixNano: String(s.startTimeUnixNano),
            endTimeUnixNano: String(s.endTimeUnixNano),
            attributes: Object.entries(s.attributes).map(([k, v]) => ({
              key: k,
              value: typeof v === 'number'
                ? { intValue: String(v) }
                : typeof v === 'boolean'
                ? { boolValue: v }
                : { stringValue: String(v) },
            })),
            status: { code: s.status.code, message: s.status.message || '' },
          })),
        }],
      }],
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers,
        },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        return { success: false, spansExported: 0, error: `OTLP HTTP ${res.status}` }
      }

      return { success: true, spansExported: spans.length }
    } catch (err: unknown) {
      return { success: false, spansExported: 0, error: String(err) }
    }
  }
}
