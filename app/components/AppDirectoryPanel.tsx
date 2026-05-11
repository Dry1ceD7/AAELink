'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/apiClient'
import { AppWindow, Search, X, Star, CheckCircle, Download, Trash2, ExternalLink, Loader2, Package } from 'lucide-react'

/* ── App Directory — Wired to /api/integrations/apps ─────────────── */

interface AppEntry {
  id: string
  name: string
  developer: string
  category: string
  description: string
  installed: boolean
  users?: number
  rating?: number
  verified?: boolean
  icon_url?: string
}

const CATEGORIES = ['All', 'Developer Tools', 'Productivity', 'Project Management', 'Communication', 'DevOps', 'Design', 'CRM']

export default function AppDirectoryPanel({ onClose }: { onClose: () => void }) {
  const [apps, setApps] = useState<AppEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('All')
  const [filterTab, setFilterTab] = useState<'all' | 'installed'>('all')
  const [selectedApp, setSelectedApp] = useState<AppEntry | null>(null)

  const loadApps = useCallback(async () => {
    try {
      setLoading(true)
      const res = await apiFetch('/api/integrations/apps')
      if (res.ok) {
        const data = await res.json()
        setApps(data.apps || [])
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { loadApps() }, [loadApps])

  const filtered = apps.filter(a => {
    if (filterTab === 'installed' && !a.installed) return false
    if (filterCategory !== 'All' && a.category !== filterCategory) return false
    if (search && !a.name.toLowerCase().includes(search.toLowerCase()) && !a.description.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const toggleInstall = async (id: string) => {
    const app = apps.find(a => a.id === id)
    if (!app) return
    setApps(prev => prev.map(a => a.id === id ? { ...a, installed: !a.installed } : a))
    if (selectedApp?.id === id) setSelectedApp({ ...selectedApp, installed: !selectedApp.installed })
    // The real install/uninstall would call marketplace API
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--mm-main-bg)', color: 'var(--mm-text)' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--mm-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #06b6d4, #0891b2)', display: 'grid', placeItems: 'center' }}>
              <AppWindow size={18} color="#fff" />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>App Directory</h2>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>{apps.length} apps · {apps.filter(a => a.installed).length} installed</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ position: 'relative', marginBottom: 10 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search apps…"
            style={{ width: '100%', padding: '10px 14px 10px 32px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          {(['all', 'installed'] as const).map(t => (
            <button key={t} onClick={() => setFilterTab(t)} style={{
              padding: '5px 12px', borderRadius: 6, border: 'none', fontSize: 12, cursor: 'pointer',
              fontWeight: filterTab === t ? 700 : 500,
              background: filterTab === t ? '#06b6d4' : 'var(--mm-hover-bg)',
              color: filterTab === t ? '#fff' : 'var(--mm-text)',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              {t === 'all' ? <><Package size={12} /> All Apps</> : <><CheckCircle size={12} /> Installed ({apps.filter(a => a.installed).length})</>}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 4 }}>
          {CATEGORIES.map(c => (
            <button key={c} onClick={() => setFilterCategory(c)} style={{
              padding: '3px 8px', borderRadius: 5, border: 'none', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
              fontWeight: filterCategory === c ? 700 : 500,
              background: filterCategory === c ? '#06b6d420' : 'transparent',
              color: filterCategory === c ? '#06b6d4' : 'var(--mm-muted)',
            }}>{c}</button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60, opacity: 0.5 }}>
            <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 13, marginTop: 8 }}>Loading apps…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60, opacity: 0.5 }}>
            <AppWindow size={36} />
            <span style={{ fontSize: 14, fontWeight: 600, marginTop: 8 }}>No apps found</span>
            <span style={{ fontSize: 12, marginTop: 4 }}>Try a different search or category</span>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {filtered.map(app => (
              <div key={app.id} onClick={() => setSelectedApp(app)} style={{
                padding: 16, borderRadius: 14, border: '1px solid var(--mm-border)', cursor: 'pointer',
                transition: 'box-shadow 200ms',
              }}
                onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.1)')}
                onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--mm-hover-bg)', display: 'grid', placeItems: 'center' }}>
                    <AppWindow size={20} style={{ color: 'var(--mm-link)' }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{app.name}</span>
                      {app.verified && <CheckCircle size={12} style={{ color: '#2bac76' }} />}
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.5 }}>{app.developer}</div>
                  </div>
                </div>
                <p style={{ margin: '0 0 10px', fontSize: 12, lineHeight: 1.5, opacity: 0.7, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{app.description}</p>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 11, opacity: 0.5, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Star size={10} /> {app.rating || '—'} · {app.users ? `${(app.users / 1000).toFixed(0)}k users` : ''}
                  </div>
                  <button onClick={e => { e.stopPropagation(); toggleInstall(app.id) }} style={{
                    padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: 'none',
                    background: app.installed ? '#e01e5a20' : '#2bac7620',
                    color: app.installed ? '#e01e5a' : '#2bac76',
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}>
                    {app.installed ? <><Trash2 size={10} /> Remove</> : <><Download size={10} /> Install</>}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedApp && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 3000, display: 'grid', placeItems: 'center' }} onClick={() => setSelectedApp(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--mm-main-bg)', borderRadius: 16, padding: 28, width: 480, maxHeight: '80vh', overflow: 'auto', boxShadow: 'var(--slack-shadow-modal)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
              <div style={{ width: 56, height: 56, borderRadius: 14, background: 'var(--mm-hover-bg)', display: 'grid', placeItems: 'center' }}>
                <AppWindow size={28} style={{ color: 'var(--mm-link)' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{selectedApp.name}</h3>
                  {selectedApp.verified && <CheckCircle size={14} style={{ color: '#2bac76' }} />}
                </div>
                <div style={{ fontSize: 13, opacity: 0.5 }}>by {selectedApp.developer}</div>
              </div>
              <button onClick={() => setSelectedApp(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}>
                <X size={20} />
              </button>
            </div>
            <p style={{ fontSize: 14, lineHeight: 1.7, opacity: 0.8, margin: '0 0 16px' }}>{selectedApp.description}</p>
            <div style={{ display: 'flex', gap: 16, marginBottom: 16, fontSize: 13 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Star size={13} /> {selectedApp.rating || '—'} rating</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Package size={13} /> {selectedApp.category}</span>
            </div>
            <button onClick={() => { toggleInstall(selectedApp.id) }} style={{
              width: '100%', padding: '12px 20px', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', border: 'none',
              background: selectedApp.installed ? '#e01e5a' : 'linear-gradient(135deg, #2bac76, #059669)',
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>{selectedApp.installed ? <><Trash2 size={16} /> Uninstall App</> : <><Download size={16} /> Install App</>}</button>
          </div>
        </div>
      )}
    </div>
  )
}
