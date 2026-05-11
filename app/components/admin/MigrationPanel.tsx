'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/apiClient'
import { AlertCircle, Upload, ArrowRightLeft, CheckCircle2, XCircle, Loader2 } from 'lucide-react'

type MigrationMapping = {
  source_user_id: string
  target_user_id: string
  source_platform: string
  mapped_at: number
}

type ImportJob = {
  id: string
  source_platform: string
  status: string
  progress: Record<string, unknown>
  error: string
  created_at: number
}

export function MigrationPanel() {
  const [mappings, setMappings] = useState<MigrationMapping[]>([])
  const [imports, setImports] = useState<ImportJob[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [msgType, setMsgType] = useState<'info' | 'error'>('info')

  // Exchange form
  const [exchangeIds, setExchangeIds] = useState('')
  const [exchangePlatform, setExchangePlatform] = useState('slack')
  const [exchangeBusy, setExchangeBusy] = useState(false)

  // Import form
  const [importPlatform, setImportPlatform] = useState('slack')
  const [importSource, setImportSource] = useState('')
  const [importBusy, setImportBusy] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/migration')
      if (res.ok) {
        const d = await res.json()
        setMappings(d.mappings || [])
        setImports(d.imports || [])
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadData() }, [loadData])

  const handleExchange = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!exchangeIds.trim()) return
    setExchangeBusy(true)
    setMsg('')

    try {
      const ids = exchangeIds.split(',').map(id => id.trim()).filter(Boolean)
      const res = await apiFetch('/api/admin/migration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'exchange',
          source_platform: exchangePlatform,
          user_ids: ids
        })
      })

      if (res.ok) {
        const d = await res.json()
        setMsg(`Exchanged ${d.mappings?.length || 0} user IDs`)
        setMsgType('info')
        setExchangeIds('')
        void loadData()
      } else {
        const d = await res.json()
        setMsg(d.error || 'Exchange failed')
        setMsgType('error')
      }
    } catch {
      setMsg('Network error')
      setMsgType('error')
    } finally {
      setExchangeBusy(false)
    }
  }

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!importSource.trim()) return
    setImportBusy(true)
    setMsg('')

    try {
      const res = await apiFetch('/api/admin/migration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'import',
          source_platform: importPlatform,
          source_url: importSource.trim()
        })
      })

      if (res.ok) {
        const d = await res.json()
        setMsg(`Import started: ${d.import?.id || 'processing'}`)
        setMsgType('info')
        setImportSource('')
        void loadData()
      } else {
        const d = await res.json()
        setMsg(d.error || 'Import failed')
        setMsgType('error')
      }
    } catch {
      setMsg('Network error')
      setMsgType('error')
    } finally {
      setImportBusy(false)
    }
  }

  const statusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle2 size={14} style={{ color: '#2ea043' }} />
      case 'failed': return <XCircle size={14} style={{ color: '#c00' }} />
      case 'running': return <Loader2 size={14} style={{ color: 'var(--aae-accent)', animation: 'spin 1s linear infinite' }} />
      default: return null
    }
  }

  if (loading) return <div style={{ fontSize: 13, color: 'var(--doc-muted)' }}>Loading migration data...</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <ArrowRightLeft size={18} style={{ color: 'var(--aae-accent, var(--aae-link))' }} />
        <h2 className="mm-auth-section-title" style={{ margin: 0 }}>Platform Migration</h2>
      </div>
      <p className="aae-auth-lead">
        Import data from Slack, Mattermost, Microsoft Teams, or CSV exports. Map user IDs across platforms for seamless migration.
      </p>

      {/* User ID Exchange */}
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>User ID Exchange</h3>
        <p style={{ fontSize: 13, color: 'var(--doc-muted)', marginBottom: 12 }}>
          Map external user IDs to AAELink users. Paste comma-separated IDs from the source platform.
        </p>
        <form onSubmit={handleExchange} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 500 }}>
          <label className="field-label" htmlFor="exchange-platform">
            Source Platform
            <select id="exchange-platform" className="slack-input" value={exchangePlatform}
              onChange={e => setExchangePlatform(e.target.value)}>
              <option value="slack">Slack</option>
              <option value="mattermost">Mattermost</option>
              <option value="teams">Microsoft Teams</option>
              <option value="discord">Discord</option>
            </select>
          </label>
          <label className="field-label" htmlFor="exchange-ids">
            User IDs (comma-separated)
            <textarea id="exchange-ids" className="slack-input" value={exchangeIds}
              onChange={e => setExchangeIds(e.target.value)}
              placeholder="U01234567, U01234568, U01234569"
              rows={3} style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }} />
          </label>
          <button type="submit" className="slack-button" disabled={exchangeBusy || !exchangeIds.trim()} style={{ justifySelf: 'start' }}>
            {exchangeBusy ? 'Exchanging...' : 'Exchange IDs'}
          </button>
        </form>
      </div>

      {/* Existing Mappings */}
      {mappings.length > 0 && (
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Existing Mappings ({mappings.length})</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
                  <th style={{ padding: '6px' }}>Source Platform</th>
                  <th style={{ padding: '6px' }}>Source ID</th>
                  <th style={{ padding: '6px' }}>AAELink ID</th>
                  <th style={{ padding: '6px' }}>Mapped At</th>
                </tr>
              </thead>
              <tbody>
                {mappings.slice(0, 50).map((m, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                    <td style={{ padding: '6px' }}>
                      <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 6, background: 'rgba(0,100,200,0.1)' }}>
                        {m.source_platform}
                      </span>
                    </td>
                    <td style={{ padding: '6px', fontFamily: 'monospace', fontSize: 11 }}>{m.source_user_id}</td>
                    <td style={{ padding: '6px', fontFamily: 'monospace', fontSize: 11 }}>{m.target_user_id}</td>
                    <td style={{ padding: '6px', fontSize: 11 }}>{m.mapped_at ? new Date(m.mapped_at).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Data Import */}
      <div style={{ borderTop: '1px solid var(--mm-border-subtle)', paddingTop: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Upload size={16} />
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Import Data</h3>
        </div>
        <form onSubmit={handleImport} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 500 }}>
          <label className="field-label" htmlFor="import-platform">
            Source Platform
            <select id="import-platform" className="slack-input" value={importPlatform}
              onChange={e => setImportPlatform(e.target.value)}>
              <option value="slack">Slack Export (JSON)</option>
              <option value="mattermost">Mattermost Export</option>
              <option value="teams">Microsoft Teams Export</option>
              <option value="csv">CSV Import</option>
            </select>
          </label>
          <label className="field-label" htmlFor="import-source">
            Source URL or File Path
            <input id="import-source" className="slack-input" value={importSource}
              onChange={e => setImportSource(e.target.value)}
              placeholder="https://files.slack.com/export/T01234567.zip" />
          </label>
          <button type="submit" className="slack-button" disabled={importBusy || !importSource.trim()} style={{ justifySelf: 'start' }}>
            {importBusy ? 'Starting...' : 'Start Import'}
          </button>
        </form>
      </div>

      {/* Import History */}
      {imports.length > 0 && (
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Import History</h3>
          <div style={{ display: 'grid', gap: 10 }}>
            {imports.map(job => (
              <div key={job.id} style={{
                border: '1px solid var(--mm-border-subtle)', padding: 12, borderRadius: 8,
                background: 'var(--mm-channel-bg)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {statusIcon(job.status)}
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{job.source_platform} import</span>
                  <span style={{
                    marginLeft: 'auto', fontSize: 11, padding: '1px 6px', borderRadius: 6,
                    background: job.status === 'completed' ? 'rgba(46,160,67,0.15)' :
                      job.status === 'failed' ? 'rgba(200,0,0,0.1)' : 'rgba(0,100,200,0.1)',
                    color: job.status === 'completed' ? '#2ea043' :
                      job.status === 'failed' ? '#c00' : 'var(--aae-accent)'
                  }}>
                    {job.status}
                  </span>
                </div>
                {job.error && <div style={{ fontSize: 12, color: '#c00', marginTop: 6 }}>{job.error}</div>}
                <div style={{ fontSize: 11, color: 'var(--doc-muted)', marginTop: 4 }}>
                  {job.created_at ? new Date(job.created_at).toLocaleString() : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {msg && (
        <div className={`mm-auth-alert mm-auth-alert--${msgType}`} role="alert">
          {msgType === 'error' && <AlertCircle size={18} strokeWidth={2} />}
          <span>{msg}</span>
        </div>
      )}
    </div>
  )
}
