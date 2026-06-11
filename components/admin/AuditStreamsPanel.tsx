'use client'

import { useCallback, useEffect, useState } from 'react'
import { Radio, Plus, Trash2, X, Loader2, Power } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import { toast } from '@/lib/ui/toast'

/* ── SIEM Audit Streams — forward audit events to Splunk/Elastic/S3/syslog ── */

type Destination = 'splunk' | 'elasticsearch' | 's3' | 'webhook' | 'syslog'
type Format = 'json' | 'cef' | 'leef'

interface StreamConfig {
  id: string
  workspace_id?: string
  destination: Destination
  endpoint_url: string
  format?: Format
  enabled?: boolean
  created_at?: number
}

const DESTINATIONS: Destination[] = ['splunk', 'elasticsearch', 's3', 'webhook', 'syslog']
const FORMATS: Format[] = ['json', 'cef', 'leef']

export default function AuditStreamsPanel({ onClose }: { onClose?: () => void }) {
  const [configs, setConfigs] = useState<StreamConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [workspaceId, setWorkspaceId] = useState('')
  const [destination, setDestination] = useState<Destination>('splunk')
  const [endpointUrl, setEndpointUrl] = useState('')
  const [authToken, setAuthToken] = useState('')
  const [format, setFormat] = useState<Format>('json')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/admin/audit-streams')
      if (res.ok) {
        const d = (await res.json()) as { configs?: StreamConfig[] }
        setConfigs(d.configs || [])
      } else {
        toast.error('Failed to load audit streams')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function createStream(e: React.FormEvent) {
    e.preventDefault()
    if (!workspaceId.trim() || !endpointUrl.trim()) return
    setBusy(true)
    try {
      const res = await apiFetch('/api/admin/audit-streams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId.trim(),
          destination,
          endpoint_url: endpointUrl.trim(),
          auth_token: authToken.trim() || undefined,
          format,
          enabled: true,
        }),
      })
      const d = (await res.json().catch(() => ({}))) as { error?: string }
      if (res.ok) {
        toast.success('Audit stream created')
        setWorkspaceId('')
        setEndpointUrl('')
        setAuthToken('')
        void load()
      } else {
        toast.error(d.error || 'Failed to create stream')
      }
    } finally {
      setBusy(false)
    }
  }

  async function toggleStream(c: StreamConfig) {
    const res = await apiFetch('/api/admin/audit-streams', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: c.id, enabled: !c.enabled }),
    })
    if (res.ok) { toast.success(c.enabled ? 'Stream disabled' : 'Stream enabled'); void load() }
    else toast.error('Failed to update stream')
  }

  async function deleteStream(id: string) {
    const res = await apiFetch('/api/admin/audit-streams', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) { toast.success('Stream deleted'); void load() }
    else toast.error('Failed to delete stream')
  }

  const input: React.CSSProperties = {
    padding: '9px 14px', borderRadius: 8, border: '1px solid var(--mm-border)',
    background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--mm-main-bg)', color: 'var(--mm-text)' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--mm-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #0ea5e9, #0369a1)', display: 'grid', placeItems: 'center' }}><Radio size={18} color="#fff" /></div>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Audit Streams</h2>
            <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>Forward audit events to your SIEM</p>
          </div>
        </div>
        {onClose && <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}><X size={18} /></button>}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--mm-muted)' }}><Loader2 size={20} className="spin" /> Loading…</div>
        ) : (
          <>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Configured Streams ({configs.length})</h3>
              {configs.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--mm-muted)' }}>No audit streams configured.</p>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {configs.map(c => (
                    <div key={c.id} style={{ padding: 12, borderRadius: 10, border: '1px solid var(--mm-border)', background: 'var(--mm-channel-bg)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{c.destination} <span style={{ fontSize: 11, opacity: 0.6 }}>· {c.format || 'json'}</span></div>
                        <div style={{ fontSize: 12, opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.endpoint_url}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8, background: c.enabled ? 'rgba(46,160,67,0.15)' : 'rgba(150,150,150,0.15)', color: c.enabled ? '#2ea043' : 'var(--mm-muted)' }}>{c.enabled ? 'Enabled' : 'Disabled'}</span>
                        <button onClick={() => void toggleStream(c)} title="Toggle" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}><Power size={15} /></button>
                        <button onClick={() => void deleteStream(c.id)} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c00' }}><Trash2 size={15} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <form onSubmit={createStream} style={{ borderTop: '1px solid var(--mm-border)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 480 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}><Plus size={14} style={{ verticalAlign: -2, marginRight: 4 }} />New Stream</h3>
              <input value={workspaceId} onChange={e => setWorkspaceId(e.target.value)} placeholder="Workspace ID" required style={input} />
              <select value={destination} onChange={e => setDestination(e.target.value as Destination)} style={input}>
                {DESTINATIONS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <input value={endpointUrl} onChange={e => setEndpointUrl(e.target.value)} placeholder="Endpoint URL" required style={input} />
              <input value={authToken} onChange={e => setAuthToken(e.target.value)} placeholder="Auth token (optional)" style={input} />
              <select value={format} onChange={e => setFormat(e.target.value as Format)} style={input}>
                {FORMATS.map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}
              </select>
              <button type="submit" disabled={busy || !workspaceId.trim() || !endpointUrl.trim()} style={{ justifySelf: 'start', background: '#4361EE', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', width: 'fit-content' }}>
                {busy ? 'Creating…' : 'Create Stream'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
