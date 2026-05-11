'use client'

import { useCallback, useEffect, useState } from 'react'
import { Scale, User, AlertTriangle, Package, Plus, X, Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'

/* ─────────────────────────────────────────────────────────────────────
   LegalHoldPanel — Legal Holds & eDiscovery
   • Place legal holds on users/channels to prevent data deletion
   • Export data for legal proceedings
   • Custodian management & matter tracking
   ───────────────────────────────────────────────────────────────────── */

interface LegalHold {
  id: string
  name: string
  matter: string
  status: string
  custodians: string[]
  channels: string[]
  created_by_username?: string
  created_at: number | string
  data_preserved?: string
  export_count?: number
}

const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
  active: { bg: '#e01e5a15', text: '#e01e5a', label: 'Active Hold' },
  released: { bg: '#2bac7615', text: '#2bac76', label: 'Released' },
  pending: { bg: '#e8912d15', text: '#e8912d', label: 'Pending Review' },
}

export default function LegalHoldPanel({ onClose }: { onClose: () => void }) {
  const [holds, setHolds] = useState<LegalHold[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [expandedHold, setExpandedHold] = useState<string | null>(null)
  const [tab, setTab] = useState<'holds' | 'exports' | 'settings'>('holds')

  // Form state
  const [formName, setFormName] = useState('')
  const [formMatter, setFormMatter] = useState('')
  const [formCustodians, setFormCustodians] = useState('')
  const [formChannels, setFormChannels] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/compliance/legal-holds')
      if (res.ok) {
        const data = await res.json() as { holds?: LegalHold[] }
        setHolds(data.holds || [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const createHold = async () => {
    if (!formName || !formMatter) return
    await apiFetch('/api/compliance/legal-holds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: formName,
        matter: formMatter,
        custodians: formCustodians.split(',').map(c => c.trim()).filter(Boolean),
        channels: formChannels.split(',').map(c => c.trim()).filter(Boolean),
      }),
    })
    setShowCreate(false)
    setFormName(''); setFormMatter(''); setFormCustodians(''); setFormChannels('')
    void load()
  }

  const releaseHold = async (id: string) => {
    if (!confirm('Release this legal hold? Data will no longer be preserved.')) return
    await apiFetch(`/api/compliance/legal-holds?hold_id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'released' }),
    })
    void load()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--mm-main-bg)', color: 'var(--mm-text)' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--mm-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #e01e5a, #be185d)', display: 'grid', placeItems: 'center', color: '#fff' }}><Scale size={18} /></div>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Legal Holds & eDiscovery</h2>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>Preserve data for legal proceedings</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowCreate(true)} style={{ background: 'linear-gradient(135deg, #e01e5a, #be185d)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}><Plus size={13} /> New Legal Hold</button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}><X size={18} /></button>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
          {[
            { label: 'Active Holds', value: holds.filter(h => h.status === 'active').length, color: '#e01e5a' },
            { label: 'Custodians', value: new Set(holds.flatMap(h => h.custodians || [])).size, color: '#4361EE' },
            { label: 'Total Holds', value: holds.length, color: '#e8912d' },
            { label: 'Exports', value: holds.reduce((s, h) => s + (h.export_count || 0), 0), color: '#2bac76' },
          ].map(s => (
            <div key={s.label} style={{ padding: 12, borderRadius: 10, border: '1px solid var(--mm-border)', textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 11, opacity: 0.6 }}>{s.label}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 4 }}>
          {(['holds', 'exports', 'settings'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '6px 14px', borderRadius: 8, border: 'none', fontSize: 13,
              fontWeight: tab === t ? 700 : 500, cursor: 'pointer',
              background: tab === t ? '#e01e5a' : 'var(--mm-hover-bg)',
              color: tab === t ? '#fff' : 'var(--mm-text)', textTransform: 'capitalize',
            }}>{t === 'holds' ? 'Legal Holds' : t === 'exports' ? 'Data Exports' : 'Settings'}</button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {tab === 'holds' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ padding: 12, borderRadius: 8, background: '#e01e5a08', border: '1px solid #e01e5a20', fontSize: 12, lineHeight: 1.6 }}>
              <AlertTriangle size={14} style={{ color: '#e01e5a', flexShrink: 0 }} /> <strong>Legal holds prevent data deletion</strong> — All messages, files, and metadata from held custodians and channels are preserved regardless of retention policies.
            </div>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 24, color: 'var(--mm-muted)' }}><Loader2 size={20} className="spin" /> Loading holds…</div>
            ) : holds.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 24, opacity: 0.5, fontSize: 13 }}>No legal holds. Create one to preserve data for legal proceedings.</div>
            ) : holds.map(hold => {
              const st = statusConfig[hold.status] || statusConfig.pending
              const expanded = expandedHold === hold.id
              return (
                <div key={hold.id} style={{ borderRadius: 12, border: '1px solid var(--mm-border)', overflow: 'hidden' }}>
                  <div onClick={() => setExpandedHold(expanded ? null : hold.id)} style={{ padding: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--mm-hover-bg)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>{hold.name}</div>
                      <div style={{ fontSize: 12, opacity: 0.6 }}>Matter: {hold.matter} · {(hold.custodians || []).length} custodian{(hold.custodians || []).length !== 1 ? 's' : ''} · {(hold.channels || []).length} channel{(hold.channels || []).length !== 1 ? 's' : ''}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, background: st.bg, color: st.text, fontWeight: 600 }}>{st.label}</span>
                      <span style={{ fontSize: 14, transition: 'transform 200ms', transform: expanded ? 'rotate(180deg)' : 'rotate(0)' }}>▾</span>
                    </div>
                  </div>
                  {expanded && (
                    <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--mm-border)', fontSize: 13 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
                        <div>
                          <div style={{ fontWeight: 600, marginBottom: 6, opacity: 0.6, fontSize: 11, textTransform: 'uppercase' }}>Custodians</div>
                          {(hold.custodians || []).map(c => <div key={c} style={{ padding: '3px 0', display: 'flex', alignItems: 'center', gap: 4 }}><User size={12} /> {c}</div>)}
                          {(!hold.custodians || hold.custodians.length === 0) && <div style={{ opacity: 0.4 }}>None specified</div>}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, marginBottom: 6, opacity: 0.6, fontSize: 11, textTransform: 'uppercase' }}>Channels</div>
                          {(hold.channels || []).map(ch => <div key={ch} style={{ padding: '3px 0' }}>{ch}</div>)}
                          {(!hold.channels || hold.channels.length === 0) && <div style={{ opacity: 0.4 }}>None specified</div>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, opacity: 0.6 }}>
                        <span>Created by {hold.created_by_username || 'admin'}</span>
                        <span>· {typeof hold.created_at === 'number' ? new Date(hold.created_at).toLocaleDateString() : hold.created_at}</span>
                        {hold.data_preserved && <span>· {hold.data_preserved} preserved</span>}
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                        <button style={{ background: '#4361EE', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>Export Data</button>
                        {hold.status === 'active' && <button onClick={(e) => { e.stopPropagation(); void releaseHold(hold.id) }} style={{ background: '#2bac7620', color: '#2bac76', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>Release Hold</button>}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {tab === 'exports' && (
          <div style={{ textAlign: 'center', padding: 60, opacity: 0.5 }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}><Package size={48} style={{ opacity: 0.5 }} /></div>
            <p style={{ fontSize: 15 }}>Export history will appear here</p>
            <p style={{ fontSize: 12 }}>Use the &quot;Export Data&quot; button on any legal hold to generate a compliance export</p>
          </div>
        )}

        {tab === 'settings' && (
          <div style={{ maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {[
              { label: 'Require dual authorization', desc: 'Legal holds require two admins to create or release' },
              { label: 'Auto-notify custodians', desc: 'Send notification to custodians when placed on hold' },
              { label: 'Include deleted messages', desc: 'Preserve soft-deleted messages in held channels' },
              { label: 'Export encryption', desc: 'Encrypt all eDiscovery exports with workspace key' },
            ].map((s, i) => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderRadius: 10, border: '1px solid var(--mm-border)' }}>
                <div><div style={{ fontWeight: 600, fontSize: 14 }}>{s.label}</div><div style={{ fontSize: 12, opacity: 0.6 }}>{s.desc}</div></div>
                <div style={{ width: 44, height: 24, borderRadius: 12, background: i < 2 ? '#2bac76' : 'var(--mm-hover-bg)', cursor: 'pointer', position: 'relative' }}>
                  <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: i < 2 ? 23 : 3 }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Hold Modal */}
      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 3000, display: 'grid', placeItems: 'center', animation: 'slack-modal-in 200ms var(--slack-ease-bounce) forwards' }} onClick={() => setShowCreate(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--mm-main-bg)', borderRadius: 16, padding: 24, width: 460, boxShadow: 'var(--slack-shadow-modal)' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 800 }}>Create Legal Hold</h3>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>Hold Name</label>
              <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g., Patent Dispute — Case #123" style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>Matter/Case Number</label>
              <input value={formMatter} onChange={e => setFormMatter(e.target.value)} placeholder="e.g., CASE-2026-002" style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>Custodians (comma-separated)</label>
              <input value={formCustodians} onChange={e => setFormCustodians(e.target.value)} placeholder="e.g., john.doe, sarah.chen" style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>Channels (comma-separated)</label>
              <input value={formChannels} onChange={e => setFormChannels(e.target.value)} placeholder="e.g., #legal, #engineering" style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowCreate(false)} style={{ background: 'var(--mm-hover-bg)', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', color: 'var(--mm-text)', fontSize: 13 }}>Cancel</button>
              <button onClick={() => void createHold()} style={{ background: '#e01e5a', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Create Hold</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
