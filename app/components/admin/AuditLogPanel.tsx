'use client'

import { useCallback, useEffect, useState } from 'react'
import { ClipboardList, KeyRound, Hash, MessageCircle, Paperclip, Settings, Plug, ShieldCheck, MapPin, Globe, Info, Download, X, Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'

/* ── Audit Log Viewer — Enterprise compliance audit trail ─────────── */

interface AuditEvent {
  id: string
  timestamp: string
  actor: string
  actor_role?: string
  action: string
  category: string
  target: string
  ip_address?: string
  location?: string
  details?: string
  created_at?: string
}

const CATEGORIES = [
  { id: 'all', label: 'All Events', icon: 'clipboard' },
  { id: 'auth', label: 'Authentication', icon: 'key' },
  { id: 'channel', label: 'Channels', icon: 'hash' },
  { id: 'message', label: 'Messages', icon: 'message' },
  { id: 'file', label: 'Files', icon: 'paperclip' },
  { id: 'admin', label: 'Admin', icon: 'settings' },
  { id: 'integration', label: 'Integrations', icon: 'plug' },
  { id: 'compliance', label: 'Compliance', icon: 'shield' },
]

const CATEGORY_ICON_MAP: Record<string, React.ComponentType<{ size: number }>> = {
  clipboard: ClipboardList, key: KeyRound, hash: Hash, message: MessageCircle,
  paperclip: Paperclip, settings: Settings, plug: Plug, shield: ShieldCheck,
}

const categoryColors: Record<string, string> = {
  auth: '#4361EE', channel: '#2bac76', message: '#06b6d4', file: '#e8912d',
  admin: '#8b5cf6', integration: '#ec4899', compliance: '#e01e5a',
}

function relativeTime(ts: string | number | undefined): string {
  if (!ts) return ''
  const d = typeof ts === 'number' ? ts : Date.parse(ts)
  if (isNaN(d)) return String(ts)
  const diff = Date.now() - d
  if (diff < 60_000) return 'Just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hours ago`
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)} days ago`
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function AuditLogPanel({ onClose }: { onClose?: () => void }) {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [filterCategory, setFilterCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (filterCategory !== 'all') params.set('category', filterCategory)
      if (search) params.set('search', search)
      const res = await apiFetch(`/api/admin/audit-log?${params}`)
      if (res.ok) {
        const data = (await res.json()) as { events?: AuditEvent[]; entries?: AuditEvent[] }
        setEvents(data.events || data.entries || [])
      }
    } finally {
      setLoading(false)
    }
  }, [filterCategory, search])

  useEffect(() => { void load() }, [load])

  async function exportCSV() {
    const res = await apiFetch('/api/admin/audit-log/export?format=csv')
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const filtered = events.filter(e => {
    if (filterCategory !== 'all' && e.category !== filterCategory) return false
    if (search && !e.actor?.toLowerCase().includes(search.toLowerCase()) && !e.action?.toLowerCase().includes(search.toLowerCase()) && !e.target?.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--mm-main-bg)', color: 'var(--mm-text)' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--mm-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #f59e0b, #d97706)', display: 'grid', placeItems: 'center' }}><ClipboardList size={18} color="#fff" /></div>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Audit Log</h2>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>Complete activity trail for your workspace</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => void exportCSV()} style={{ background: 'var(--mm-hover-bg)', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer', color: 'var(--mm-text)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}><Download size={13} /> Export CSV</button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}><X size={18} /></button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search actors, actions, targets…" style={{ flex: 1, padding: '9px 14px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13, outline: 'none' }} />
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {CATEGORIES.map(c => (
            <button key={c.id} onClick={() => setFilterCategory(c.id)} style={{
              padding: '4px 10px', borderRadius: 6, border: 'none', fontSize: 12,
              fontWeight: filterCategory === c.id ? 700 : 500, cursor: 'pointer',
              background: filterCategory === c.id ? (categoryColors[c.id] || '#4361EE') : 'var(--mm-hover-bg)',
              color: filterCategory === c.id ? '#fff' : 'var(--mm-text)',
            }}>{(() => { const Icon = CATEGORY_ICON_MAP[c.icon]; return Icon ? <Icon size={12} /> : null; })()} {c.label}</button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--mm-muted)' }}><Loader2 size={20} className="spin" /> Loading audit events…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--mm-muted)', fontSize: 13 }}>No audit events found.</div>
        ) : (
          filtered.map(ev => {
            const expanded = expandedEvent === ev.id
            const color = categoryColors[ev.category] || '#4361EE'
            return (
              <div key={ev.id} onClick={() => setExpandedEvent(expanded ? null : ev.id)} style={{
                padding: '10px 12px', borderRadius: 8, marginBottom: 4, cursor: 'pointer',
                borderLeft: `3px solid ${color}`, transition: 'background 150ms',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--mm-hover-bg)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <code style={{ fontSize: 12, color, fontWeight: 600 }}>{ev.action}</code>
                    <span style={{ fontSize: 12, opacity: 0.7 }}>by <strong>{ev.actor}</strong></span>
                    <span style={{ fontSize: 12, opacity: 0.5 }}>→ {ev.target}</span>
                  </div>
                  <span style={{ fontSize: 11, opacity: 0.4 }}>{relativeTime(ev.created_at || ev.timestamp)}</span>
                </div>
                {expanded && (
                  <div style={{ marginTop: 8, fontSize: 12, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, opacity: 0.7 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><MapPin size={11} /> {ev.location || 'Unknown'}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Globe size={11} /> {ev.ip_address || 'Unknown'}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Info size={11} /> {ev.details || ev.actor_role || '-'}</div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
