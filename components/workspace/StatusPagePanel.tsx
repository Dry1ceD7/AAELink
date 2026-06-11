'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api/apiClient'
import { Activity, CheckCircle, AlertTriangle, AlertOctagon, Wrench, ChevronDown, ChevronUp, X, Loader2 } from 'lucide-react'

/* ── Status Page — Wired to /api/admin/status ────────────────────── */

interface StatusService {
  id: string
  name: string
  status: 'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'maintenance'
  uptime: string
  lastIncident?: string
}

interface Incident {
  id: string
  title: string
  severity: 'minor' | 'major' | 'critical'
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved'
  createdAt: string
  resolvedAt?: string
  updates: { time: string; message: string }[]
}

const statusConfig: Record<string, { color: string; bg: string; label: string; Icon: typeof CheckCircle }> = {
  operational: { color: '#2bac76', bg: '#2bac7620', label: 'Operational', Icon: CheckCircle },
  degraded: { color: '#f59e0b', bg: '#f59e0b20', label: 'Degraded', Icon: AlertTriangle },
  partial_outage: { color: '#e8912d', bg: '#e8912d20', label: 'Partial Outage', Icon: AlertTriangle },
  major_outage: { color: '#e01e5a', bg: '#e01e5a20', label: 'Major Outage', Icon: AlertOctagon },
  maintenance: { color: '#4361EE', bg: '#4361EE20', label: 'Maintenance', Icon: Wrench },
}

const severityColors: Record<string, string> = { minor: '#f59e0b', major: '#e8912d', critical: '#e01e5a' }

export default function StatusPagePanel({ onClose }: { onClose: () => void }) {
  const [services, setServices] = useState<StatusService[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedIncident, setExpandedIncident] = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/admin/status')
      if (res.ok) {
        const data = await res.json()
        setServices(data.services || [])
        setIncidents(data.incidents || [])
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { loadStatus() }, [loadStatus])

  const allOperational = services.length > 0 && services.every(s => s.status === 'operational')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--mm-main-bg)', color: 'var(--mm-text)' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--mm-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: allOperational ? 'linear-gradient(135deg, #2bac76, #059669)' : 'linear-gradient(135deg, #f59e0b, #e8912d)', display: 'grid', placeItems: 'center' }}>
              {allOperational ? <CheckCircle size={18} color="#fff" /> : <AlertTriangle size={18} color="#fff" />}
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>System Status</h2>
              <p style={{ margin: 0, fontSize: 12, color: allOperational ? '#2bac76' : '#f59e0b', fontWeight: 600 }}>
                {loading ? 'Checking…' : allOperational ? 'All Systems Operational' : 'Some Systems Degraded'}
              </p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 14, borderRadius: 12, background: allOperational ? '#2bac7608' : '#f59e0b08', border: `1px solid ${allOperational ? '#2bac7630' : '#f59e0b30'}`, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Activity size={16} style={{ color: allOperational ? '#2bac76' : '#f59e0b' }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: allOperational ? '#2bac76' : '#f59e0b' }}>
            {loading ? 'Checking system status…' : allOperational ? 'All systems are operating normally' : 'Monitoring degraded performance on some services'}
          </span>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60, opacity: 0.5 }}>
            <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 13, marginTop: 8 }}>Loading status…</span>
          </div>
        ) : (
          <>
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 12px' }}>Services</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 24 }}>
              {services.map(svc => {
                const st = statusConfig[svc.status] || statusConfig.operational
                return (
                  <div key={svc.id} style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid var(--mm-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <st.Icon size={16} style={{ color: st.color }} />
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{svc.name}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 11, opacity: 0.4 }}>Uptime: {svc.uptime}</span>
                      <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: st.bg, color: st.color, fontWeight: 600 }}>{st.label}</span>
                    </div>
                  </div>
                )
              })}
            </div>

            <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 12px' }}>Recent Incidents</h3>
            {incidents.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, opacity: 0.5 }}>
                <CheckCircle size={36} style={{ marginBottom: 8 }} />
                <p>No recent incidents</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {incidents.map(inc => (
                  <div key={inc.id} style={{ padding: 14, borderRadius: 12, border: '1px solid var(--mm-border)', borderLeft: `3px solid ${severityColors[inc.severity] || '#f59e0b'}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => setExpandedIncident(expandedIncident === inc.id ? null : inc.id)}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{inc.title}</div>
                        <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2 }}>{inc.createdAt} · {inc.severity}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: inc.status === 'resolved' ? '#2bac7620' : '#f59e0b20', color: inc.status === 'resolved' ? '#2bac76' : '#f59e0b', fontWeight: 600 }}>{inc.status}</span>
                        {expandedIncident === inc.id ? <ChevronUp size={14} style={{ opacity: 0.4 }} /> : <ChevronDown size={14} style={{ opacity: 0.4 }} />}
                      </div>
                    </div>
                    {expandedIncident === inc.id && (
                      <div style={{ marginTop: 12, paddingLeft: 12, borderLeft: '2px solid var(--mm-border)' }}>
                        {(inc.updates || []).map((u, i) => (
                          <div key={i} style={{ marginBottom: 10, fontSize: 13 }}>
                            <div style={{ fontWeight: 600, fontSize: 11, opacity: 0.5, marginBottom: 2 }}>{u.time}</div>
                            <p style={{ margin: 0, lineHeight: 1.5, opacity: 0.8 }}>{u.message}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
