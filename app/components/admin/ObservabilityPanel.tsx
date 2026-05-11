'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/apiClient'
import { Activity, Clock, AlertTriangle, TrendingUp, Zap, BarChart3, RefreshCw } from 'lucide-react'

type SystemMetrics = {
  uptime_ms: number
  uptime_human: string
  total_requests: number
  total_errors: number
  error_rate: number
  routes_tracked: number
  avg_latency_ms: number
  recent_spans: number
}

type RouteMetric = {
  route: string
  method: string
  count: number
  totalMs: number
  errors: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  lastCalled: number
}

type TraceSpan = {
  traceId: string
  spanId: string
  name: string
  method: string
  status: string
  durationMs: number | null
  httpStatus?: number
  error?: string
  timestamp: number
}

export function ObservabilityPanel() {
  const [system, setSystem] = useState<SystemMetrics | null>(null)
  const [routes, setRoutes] = useState<RouteMetric[]>([])
  const [traces, setTraces] = useState<TraceSpan[]>([])
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [sortBy, setSortBy] = useState<'count' | 'p95' | 'errors'>('count')

  const loadData = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/tracing')
      if (res.ok) {
        const d = await res.json()
        setSystem(d.system || null)
        setRoutes(d.routes || [])
        setTraces(d.traces || [])
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadData() }, [loadData])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(() => void loadData(), 5000)
    return () => clearInterval(interval)
  }, [autoRefresh, loadData])

  const sortedRoutes = [...routes].sort((a, b) => {
    if (sortBy === 'p95') return b.p95Ms - a.p95Ms
    if (sortBy === 'errors') return b.errors - a.errors
    return b.count - a.count
  })

  const latencyColor = (ms: number) => {
    if (ms < 50) return '#2ea043'
    if (ms < 200) return '#c89600'
    if (ms < 500) return '#d29922'
    return '#c00'
  }

  const statusColor = (status: string) => {
    if (status === 'ok') return 'rgba(46,160,67,0.15)'
    if (status === 'error') return 'rgba(200,0,0,0.1)'
    return 'rgba(100,100,100,0.1)'
  }

  if (loading) return <div style={{ fontSize: 13, color: 'var(--doc-muted)' }}>Loading observability data...</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Activity size={18} style={{ color: 'var(--aae-accent, var(--aae-link))' }} />
        <h2 className="mm-auth-section-title" style={{ margin: 0 }}>Observability & Tracing</h2>
        <span style={{ flex: 1 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: 'var(--doc-muted)' }}>
          <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
          Auto-refresh (5s)
        </label>
        <button type="button" className="ghost-button" onClick={() => void loadData()}
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '4px 8px' }}>
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* System Overview Cards */}
      {system && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          {[
            { label: 'Uptime', value: system.uptime_human, icon: <Clock size={16} />, color: '#2ea043' },
            { label: 'Total Requests', value: system.total_requests.toLocaleString(), icon: <TrendingUp size={16} />, color: 'var(--aae-accent, #0064c8)' },
            { label: 'Errors', value: system.total_errors.toLocaleString(), icon: <AlertTriangle size={16} />, color: system.total_errors > 0 ? '#c00' : '#2ea043' },
            { label: 'Error Rate', value: `${system.error_rate}%`, icon: <AlertTriangle size={16} />, color: system.error_rate > 5 ? '#c00' : system.error_rate > 1 ? '#c89600' : '#2ea043' },
            { label: 'Avg Latency', value: `${system.avg_latency_ms}ms`, icon: <Zap size={16} />, color: latencyColor(system.avg_latency_ms) },
            { label: 'Routes Tracked', value: system.routes_tracked, icon: <BarChart3 size={16} />, color: 'var(--aae-accent, #0064c8)' },
          ].map(card => (
            <div key={card.label} style={{
              padding: '16px', borderRadius: 10,
              background: 'var(--mm-bg-secondary, #f8f9fa)',
              border: '1px solid var(--mm-border-subtle)',
              textAlign: 'center',
            }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8, color: card.color }}>
                {card.icon}
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: card.color }}>
                {card.value}
              </div>
              <div style={{ fontSize: 11, color: 'var(--mm-muted)', marginTop: 4 }}>{card.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Route Metrics Table */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Route Performance ({routes.length})</h3>
          <span style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 4, fontSize: 11 }}>
            <span style={{ color: 'var(--doc-muted)' }}>Sort:</span>
            {(['count', 'p95', 'errors'] as const).map(s => (
              <button key={s} type="button" className="ghost-button"
                style={{
                  padding: '2px 8px', fontSize: 11, borderRadius: 6,
                  background: sortBy === s ? 'var(--aae-accent, #0064c8)' : 'transparent',
                  color: sortBy === s ? '#fff' : 'var(--fg)',
                }}
                onClick={() => setSortBy(s)}>
                {s === 'count' ? 'Requests' : s === 'p95' ? 'P95 Latency' : 'Errors'}
              </button>
            ))}
          </div>
        </div>

        {sortedRoutes.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--doc-muted)' }}>
            No route metrics collected yet. Metrics populate as requests are served.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--mm-border-subtle)' }}>
                  <th style={{ padding: '8px 6px', fontWeight: 600 }}>Route</th>
                  <th style={{ padding: '8px 6px', fontWeight: 600 }}>Method</th>
                  <th style={{ padding: '8px 6px', fontWeight: 600, textAlign: 'right' }}>Requests</th>
                  <th style={{ padding: '8px 6px', fontWeight: 600, textAlign: 'right' }}>Errors</th>
                  <th style={{ padding: '8px 6px', fontWeight: 600, textAlign: 'right' }}>P50</th>
                  <th style={{ padding: '8px 6px', fontWeight: 600, textAlign: 'right' }}>P95</th>
                  <th style={{ padding: '8px 6px', fontWeight: 600, textAlign: 'right' }}>P99</th>
                  <th style={{ padding: '8px 6px', fontWeight: 600, textAlign: 'right' }}>Avg</th>
                </tr>
              </thead>
              <tbody>
                {sortedRoutes.slice(0, 50).map((r, i) => (
                  <tr key={i} style={{
                    borderBottom: '1px solid rgba(0,0,0,0.05)',
                    background: r.errors > 0 ? 'rgba(200,0,0,0.03)' : 'transparent',
                  }}>
                    <td style={{ padding: '6px', fontFamily: 'monospace', fontSize: 11 }}>{r.route}</td>
                    <td style={{ padding: '6px' }}>
                      <span style={{
                        fontSize: 10, padding: '1px 5px', borderRadius: 4, fontWeight: 600,
                        background: r.method === 'GET' ? 'rgba(46,160,67,0.12)' :
                          r.method === 'POST' ? 'rgba(0,100,200,0.12)' :
                          r.method === 'DELETE' ? 'rgba(200,0,0,0.12)' : 'rgba(200,150,0,0.12)',
                        color: r.method === 'GET' ? '#2ea043' :
                          r.method === 'POST' ? '#0064c8' :
                          r.method === 'DELETE' ? '#c00' : '#c89600',
                      }}>
                        {r.method}
                      </span>
                    </td>
                    <td style={{ padding: '6px', textAlign: 'right', fontWeight: 600 }}>{r.count.toLocaleString()}</td>
                    <td style={{ padding: '6px', textAlign: 'right', color: r.errors > 0 ? '#c00' : 'var(--doc-muted)' }}>
                      {r.errors > 0 ? r.errors : '—'}
                    </td>
                    <td style={{ padding: '6px', textAlign: 'right', color: latencyColor(r.p50Ms) }}>
                      {r.p50Ms.toFixed(1)}ms
                    </td>
                    <td style={{ padding: '6px', textAlign: 'right', fontWeight: 600, color: latencyColor(r.p95Ms) }}>
                      {r.p95Ms.toFixed(1)}ms
                    </td>
                    <td style={{ padding: '6px', textAlign: 'right', color: latencyColor(r.p99Ms) }}>
                      {r.p99Ms.toFixed(1)}ms
                    </td>
                    <td style={{ padding: '6px', textAlign: 'right', color: 'var(--doc-muted)' }}>
                      {(r.totalMs / r.count).toFixed(1)}ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Traces */}
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Recent Traces ({traces.length})</h3>
        {traces.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--doc-muted)' }}>
            No traces recorded yet. Enable <code>withTracing()</code> on route handlers.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--mm-border-subtle)' }}>
                  <th style={{ padding: '8px 6px' }}>Status</th>
                  <th style={{ padding: '8px 6px' }}>Method</th>
                  <th style={{ padding: '8px 6px' }}>Route</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>Duration</th>
                  <th style={{ padding: '8px 6px' }}>Trace ID</th>
                  <th style={{ padding: '8px 6px' }}>Error</th>
                </tr>
              </thead>
              <tbody>
                {traces.slice(0, 30).map((t, i) => (
                  <tr key={i} style={{
                    borderBottom: '1px solid rgba(0,0,0,0.05)',
                    background: t.status === 'error' ? 'rgba(200,0,0,0.03)' : 'transparent',
                  }}>
                    <td style={{ padding: '6px' }}>
                      <span style={{
                        display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                        background: t.status === 'ok' ? '#2ea043' : t.status === 'error' ? '#c00' : '#999',
                      }} />
                    </td>
                    <td style={{ padding: '6px', fontSize: 10, fontWeight: 600 }}>{t.method}</td>
                    <td style={{ padding: '6px', fontFamily: 'monospace', fontSize: 11 }}>{t.name}</td>
                    <td style={{ padding: '6px', textAlign: 'right', color: t.durationMs != null ? latencyColor(t.durationMs) : 'var(--doc-muted)' }}>
                      {t.durationMs != null ? `${t.durationMs.toFixed(1)}ms` : '—'}
                    </td>
                    <td style={{ padding: '6px', fontFamily: 'monospace', fontSize: 10, color: 'var(--doc-muted)' }}>
                      {t.traceId.slice(0, 16)}…
                    </td>
                    <td style={{ padding: '6px', fontSize: 11, color: '#c00', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.error || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
