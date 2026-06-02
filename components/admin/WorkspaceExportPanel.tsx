'use client'

import { useCallback, useEffect, useState } from 'react'
import { Package, MessageCircle, Paperclip, Users, Hash, CalendarDays, HardDrive, Download, RotateCcw, Plus, X, Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'

/* ── Workspace Export — Compliance data export & import ───────────── */

interface ExportJob {
  id: string
  type: string
  status: string
  requested_by?: string
  requested_by_name?: string
  created_at: string
  started_at?: string
  completed_at?: string
  file_size?: number
  file_url?: string
  channels_filter?: string[]
  date_from?: string
  date_to?: string
  error_message?: string
}

const typeLabels: Record<string, { label: string; icon: string; color: string }> = {
  full: { label: 'Full Export', icon: 'package', color: '#8b5cf6' },
  messages: { label: 'Messages', icon: 'message', color: '#4361EE' },
  files: { label: 'Files', icon: 'paperclip', color: '#e8912d' },
  members: { label: 'Members', icon: 'users', color: '#2bac76' },
  channels: { label: 'Channels', icon: 'hash', color: '#06b6d4' },
}

const TYPE_ICON_MAP: Record<string, React.ComponentType<{ size: number; color?: string }>> = {
  package: Package, message: MessageCircle, paperclip: Paperclip, users: Users, hash: Hash,
}

const statusStyles: Record<string, { bg: string; color: string; label: string }> = {
  queued: { bg: '#8b8b8b20', color: '#8b8b8b', label: 'Queued' },
  processing: { bg: '#f59e0b20', color: '#f59e0b', label: 'Processing…' },
  completed: { bg: '#2bac7620', color: '#2bac76', label: 'Completed' },
  failed: { bg: '#e01e5a20', color: '#e01e5a', label: 'Failed' },
}

function humanSize(bytes: number | undefined): string {
  if (!bytes) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(1)} GB`
}

function relativeTime(ts: string | undefined): string {
  if (!ts) return ''
  const d = Date.parse(ts)
  if (isNaN(d)) return ts
  const diff = Date.now() - d
  if (diff < 60_000) return 'Just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hours ago`
  return `${Math.floor(diff / 86_400_000)} days ago`
}

export default function WorkspaceExportPanel({ onClose }: { onClose: () => void }) {
  const [exports, setExports] = useState<ExportJob[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewExport, setShowNewExport] = useState(false)
  const [exportType, setExportType] = useState<string>('full')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [channels, setChannels] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/admin/exports')
      if (res.ok) {
        const data = await res.json() as { jobs?: ExportJob[] }
        setExports(data.jobs || [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const startExport = async () => {
    const body: Record<string, unknown> = { type: exportType }
    if (dateFrom) body.date_from = dateFrom
    if (dateTo) body.date_to = dateTo
    if (channels) body.channels_filter = channels.split(',').map(c => c.trim())
    await apiFetch('/api/admin/exports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setShowNewExport(false)
    void load()
  }

  async function retryExport(id: string) {
    await apiFetch('/api/admin/exports', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: 'queued' }),
    })
    void load()
  }

  const totalSize = exports.filter(e => e.status === 'completed').reduce((s, e) => s + (e.file_size || 0), 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--mm-main-bg)', color: 'var(--mm-text)' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--mm-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', display: 'grid', placeItems: 'center' }}><Package size={18} color="#fff" /></div>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Workspace Export</h2>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>Export workspace data for compliance & backup</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowNewExport(true)} style={{ background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}><Plus size={13} /> New Export</button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}><X size={18} /></button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {[
            { label: 'Total Exports', value: exports.length, color: '#8b5cf6' },
            { label: 'Completed', value: exports.filter(e => e.status === 'completed').length, color: '#2bac76' },
            { label: 'In Progress', value: exports.filter(e => e.status === 'processing' || e.status === 'queued').length, color: '#f59e0b' },
            { label: 'Total Size', value: humanSize(totalSize), color: '#4361EE' },
          ].map(s => (
            <div key={s.label} style={{ padding: 12, borderRadius: 10, border: '1px solid var(--mm-border)', textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 11, opacity: 0.6 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--mm-muted)' }}><Loader2 size={20} className="spin" /> Loading exports…</div>
        ) : exports.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, opacity: 0.5, fontSize: 13 }}>No export jobs yet. Create one to get started.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {exports.map(exp => {
              const t = typeLabels[exp.type] || typeLabels.full
              const st = statusStyles[exp.status] || statusStyles.queued
              return (
                <div key={exp.id} style={{ padding: 14, borderRadius: 12, border: '1px solid var(--mm-border)', borderLeft: `3px solid ${t.color}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ display: 'flex' }}>{(() => { const Icon = TYPE_ICON_MAP[t.icon]; return Icon ? <Icon size={18} color={t.color} /> : null; })()}</span>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{t.label}</span>
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: st.bg, color: st.color, fontWeight: 600 }}>{st.label}</span>
                    </div>
                    <span style={{ fontSize: 11, opacity: 0.4 }}>{relativeTime(exp.created_at)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 16, fontSize: 12, opacity: 0.6, marginBottom: 8 }}>
                    <span>By: {exp.requested_by_name || exp.requested_by || 'admin'}</span>
                    {(exp.date_from || exp.date_to) && <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}><CalendarDays size={11} /> {exp.date_from || '∞'} — {exp.date_to || '∞'}</span>}
                    {exp.channels_filter && exp.channels_filter.length > 0 && <span>#{exp.channels_filter.join(', #')}</span>}
                    {exp.file_size != null && <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}><HardDrive size={11} /> {humanSize(exp.file_size)}</span>}
                  </div>
                  {exp.status === 'processing' && (
                    <div style={{ height: 4, borderRadius: 2, background: 'var(--mm-hover-bg)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: '65%', borderRadius: 2, background: `linear-gradient(90deg, ${t.color}, ${t.color}88)`, animation: 'shimmer 2s infinite' }} />
                    </div>
                  )}
                  {exp.status === 'completed' && exp.file_url && (
                    <a href={exp.file_url} download style={{ textDecoration: 'none' }}>
                      <button style={{ background: '#2bac7620', color: '#2bac76', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}><Download size={12} /> Download</button>
                    </a>
                  )}
                  {exp.status === 'failed' && (
                    <div>
                      {exp.error_message && <div style={{ fontSize: 12, color: '#e01e5a', marginBottom: 4 }}>{exp.error_message}</div>}
                      <button onClick={() => void retryExport(exp.id)}
                        style={{ background: '#e01e5a20', color: '#e01e5a', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}><RotateCcw size={12} /> Retry</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showNewExport && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 3000, display: 'grid', placeItems: 'center' }} onClick={() => setShowNewExport(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--mm-main-bg)', borderRadius: 16, padding: 24, width: 440, boxShadow: '0 24px 80px rgba(0,0,0,0.3)' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 800 }}>New Export Request</h3>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>Export Type</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {Object.entries(typeLabels).map(([key, val]) => (
                  <button key={key} onClick={() => setExportType(key)} style={{
                    padding: 12, borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                    border: exportType === key ? `2px solid ${val.color}` : '1px solid var(--mm-border)',
                    background: exportType === key ? `${val.color}10` : 'transparent',
                    color: 'var(--mm-text)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>{(() => { const Icon = TYPE_ICON_MAP[val.icon]; return Icon ? <Icon size={20} color={val.color} /> : null; })()}</div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{val.label}</div>
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>Date Range</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13 }} />
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13 }} />
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>Channels (optional, comma-separated)</label>
              <input value={channels} onChange={e => setChannels(e.target.value)} placeholder="Leave empty for all channels" style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowNewExport(false)} style={{ background: 'var(--mm-hover-bg)', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', color: 'var(--mm-text)', fontSize: 13 }}>Cancel</button>
              <button onClick={() => void startExport()} style={{ background: '#8b5cf6', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Start Export</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
