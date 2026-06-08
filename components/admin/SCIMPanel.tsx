'use client'

import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Plug, RefreshCw, Copy, X, Loader2, Plus } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import { toast } from '@/lib/ui/toast'

/* ── SCIM 2.0 Provisioning — IDP user/group sync (Azure AD, Okta, OneLogin) ── */

interface ScimConnection {
  id: string
  name: string
  provider?: string
  tenant_id?: string
  is_active?: boolean
  created_at?: number
}

interface ScimStats {
  total_provisioned: number
  active: number
  deactivated: number
  last_sync: number
}

interface ScimSyncEntry {
  id: string
  action?: string
  external_id?: string
  user_id?: string
  status?: string
  created_at?: number
}

function fmtTs(ts?: number): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString()
}

export default function SCIMPanel({ onClose }: { onClose?: () => void }) {
  const [connections, setConnections] = useState<ScimConnection[]>([])
  const [stats, setStats] = useState<ScimStats | null>(null)
  const [syncLog, setSyncLog] = useState<ScimSyncEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [provider, setProvider] = useState('azure_ad')
  const [busy, setBusy] = useState(false)
  const [newToken, setNewToken] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/admin/scim')
      if (res.ok) {
        const d = (await res.json()) as {
          connections?: ScimConnection[]; stats?: ScimStats; sync_log?: ScimSyncEntry[]
        }
        setConnections(d.connections || [])
        setStats(d.stats || null)
        setSyncLog(d.sync_log || [])
      } else {
        toast.error('Failed to load SCIM connections')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function createConnection(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setNewToken('')
    try {
      const res = await apiFetch('/api/admin/scim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_connection', name: name.trim(), provider }),
      })
      const d = (await res.json().catch(() => ({}))) as {
        connection?: { bearer_token?: string }; error?: string
      }
      if (res.ok) {
        toast.success('SCIM connection created')
        setNewToken(d.connection?.bearer_token || '')
        setName('')
        void load()
      } else {
        toast.error(d.error || 'Failed to create connection')
      }
    } finally {
      setBusy(false)
    }
  }

  const card: React.CSSProperties = {
    flex: 1, minWidth: 120, padding: 12, borderRadius: 10,
    background: 'var(--mm-hover-bg)', border: '1px solid var(--mm-border)',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--mm-main-bg)', color: 'var(--mm-text)' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--mm-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #6366f1, #4338ca)', display: 'grid', placeItems: 'center' }}><Plug size={18} color="#fff" /></div>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>SCIM Provisioning</h2>
            <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>Automated user sync from your identity provider</p>
          </div>
        </div>
        {onClose && <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}><X size={18} /></button>}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--mm-muted)' }}><Loader2 size={20} className="spin" /> Loading…</div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={card}><div style={{ fontSize: 22, fontWeight: 800 }}>{stats?.total_provisioned ?? 0}</div><div style={{ fontSize: 12, opacity: 0.6 }}>Provisioned</div></div>
              <div style={card}><div style={{ fontSize: 22, fontWeight: 800, color: '#2ea043' }}>{stats?.active ?? 0}</div><div style={{ fontSize: 12, opacity: 0.6 }}>Active</div></div>
              <div style={card}><div style={{ fontSize: 22, fontWeight: 800, color: '#e01e5a' }}>{stats?.deactivated ?? 0}</div><div style={{ fontSize: 12, opacity: 0.6 }}>Deactivated</div></div>
              <div style={card}><div style={{ fontSize: 13, fontWeight: 700 }}>{fmtTs(stats?.last_sync)}</div><div style={{ fontSize: 12, opacity: 0.6 }}>Last Sync</div></div>
            </div>

            <div>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Connections ({connections.length})</h3>
              {connections.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--mm-muted)' }}>No SCIM connections configured.</p>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {connections.map(c => (
                    <div key={c.id} style={{ padding: 12, borderRadius: 10, border: '1px solid var(--mm-border)', background: 'var(--mm-channel-bg)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div>
                        <div style={{ fontSize: 12, opacity: 0.6 }}>{c.provider || 'azure_ad'} · {fmtTs(c.created_at)}</div>
                      </div>
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8, background: c.is_active ? 'rgba(46,160,67,0.15)' : 'rgba(200,0,0,0.1)', color: c.is_active ? '#2ea043' : '#c00' }}>{c.is_active ? 'Active' : 'Inactive'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <form onSubmit={createConnection} style={{ borderTop: '1px solid var(--mm-border)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 480 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}><Plus size={14} style={{ verticalAlign: -2, marginRight: 4 }} />New Connection</h3>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Connection name" required style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13 }} />
              <select value={provider} onChange={e => setProvider(e.target.value)} style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13 }}>
                <option value="azure_ad">Azure AD</option>
                <option value="okta">Okta</option>
                <option value="onelogin">OneLogin</option>
              </select>
              <button type="submit" disabled={busy || !name.trim()} style={{ justifySelf: 'start', background: '#4361EE', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, width: 'fit-content' }}>
                <KeyRound size={14} /> {busy ? 'Creating…' : 'Create & Generate Token'}
              </button>
              {newToken && (
                <div style={{ padding: 10, borderRadius: 8, background: 'var(--mm-hover-bg)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <code style={{ flex: 1, wordBreak: 'break-all' }}>{newToken}</code>
                  <button type="button" onClick={() => { void navigator.clipboard.writeText(newToken); toast.info('Token copied') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}><Copy size={14} /></button>
                </div>
              )}
            </form>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Recent Sync Log</h3>
                <button onClick={() => void load()} style={{ background: 'var(--mm-hover-bg)', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--mm-text)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><RefreshCw size={12} /> Refresh</button>
              </div>
              {syncLog.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--mm-muted)' }}>No sync events yet.</p>
              ) : (
                <div style={{ display: 'grid', gap: 4 }}>
                  {syncLog.map(s => (
                    <div key={s.id} style={{ padding: '8px 10px', borderRadius: 6, fontSize: 12, display: 'flex', justifyContent: 'space-between', borderLeft: `3px solid ${s.status === 'success' ? '#2ea043' : '#e01e5a'}` }}>
                      <span><code>{s.action}</code> · {s.external_id || '—'}</span>
                      <span style={{ opacity: 0.5 }}>{fmtTs(s.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
