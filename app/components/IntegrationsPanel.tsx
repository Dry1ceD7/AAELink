'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/apiClient'
import { Webhook, AppWindow, Plus, Trash2, Copy, Check } from 'lucide-react'

type Tab = 'webhooks' | 'apps'

interface WebhookData {
  id: string
  name: string
  channel_name: string
  app_name?: string
  secret_token: string
  created_at: number
}

interface AppData {
  id: string
  name: string
  description: string
  icon_url: string
}

interface Channel {
  id: string
  name: string
  type: string
}

export function IntegrationsPanel({ workspaceId }: { workspaceId: string }) {
  const [activeTab, setActiveTab] = useState<Tab>('webhooks')

  const [webhooks, setWebhooks] = useState<WebhookData[]>([])
  const [apps, setApps] = useState<AppData[]>([])
  const [channels, setChannels] = useState<Channel[]>([])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [showWebhookForm, setShowWebhookForm] = useState(false)
  const [showAppForm, setShowAppForm] = useState(false)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)

  // SSR-safe origin: hydrate to window.location.origin only after mount.
  // Falls back to NEXT_PUBLIC_APP_URL when configured (e.g. for transactional
  // emails that previously embedded an "undefined" host).
  const [origin, setOrigin] = useState<string>('')
  useEffect(() => {
    const envUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
    if (typeof window !== 'undefined' && window.location?.origin) {
      setOrigin(window.location.origin)
    } else if (envUrl) {
      setOrigin(envUrl)
    }
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      if (activeTab === 'webhooks') {
        const [hookRes, chanRes, appRes] = await Promise.all([
          apiFetch(`/api/integrations/webhooks?workspace_id=${workspaceId}`),
          apiFetch(`/api/channels?workspace_id=${workspaceId}`),
          apiFetch(`/api/integrations/apps?workspace_id=${workspaceId}`)
        ])
        if (hookRes.ok) setWebhooks((await hookRes.json()).webhooks || [])
        if (chanRes.ok) setChannels((await chanRes.json()).channels || [])
        if (appRes.ok) setApps((await appRes.json()).apps || [])
      } else {
        const res = await apiFetch(`/api/integrations/apps?workspace_id=${workspaceId}`)
        if (res.ok) setApps((await res.json()).apps || [])
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [workspaceId, activeTab])

  useEffect(() => { void loadData() }, [loadData])

  const handleCreateWebhook = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const name = (form.elements.namedItem('name') as HTMLInputElement).value
    const channel_id = (form.elements.namedItem('channel_id') as HTMLSelectElement).value
    const app_id = (form.elements.namedItem('app_id') as HTMLSelectElement).value

    try {
      const res = await apiFetch('/api/integrations/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, name, channel_id, app_id: app_id || null })
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error || 'Failed to create webhook')
      }
      setShowWebhookForm(false)
      loadData()
    } catch (err: any) { alert(err.message) }
  }

  const handleDeleteWebhook = async (id: string) => {
    if (!confirm('Delete this webhook? Any external service still posting to its URL will start receiving 404s.')) return
    try {
      const res = await apiFetch(`/api/integrations/webhooks/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error || 'Failed to delete webhook')
      }
      loadData()
    } catch (err: any) { alert(err.message) }
  }

  const handleCreateApp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const name = (form.elements.namedItem('name') as HTMLInputElement).value
    const description = (form.elements.namedItem('description') as HTMLInputElement).value
    const icon_url = (form.elements.namedItem('icon_url') as HTMLInputElement).value

    try {
      const res = await apiFetch('/api/integrations/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, name, description, icon_url })
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error || 'Failed to register app')
      }
      setShowAppForm(false)
      loadData()
    } catch (err: any) { alert(err.message) }
  }

  const buildWebhookUrl = (token: string): string => {
    const base = origin || ''
    return `${base}/api/webhooks/${token}`
  }

  const copyToClipboard = (token: string) => {
    const url = buildWebhookUrl(token)
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(url).catch(() => { /* noop */ })
    }
    setCopiedToken(token)
    setTimeout(() => setCopiedToken(null), 2000)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--mm-border-color)', padding: '16px 24px 0', gap: 24 }}>
        <button
          className={`tab-button ${activeTab === 'webhooks' ? 'active' : ''}`}
          onClick={() => setActiveTab('webhooks')}
          style={{ padding: '8px 0', borderBottom: activeTab === 'webhooks' ? '2px solid var(--mm-link-color)' : '2px solid transparent', color: activeTab === 'webhooks' ? 'var(--mm-link-color)' : 'var(--mm-muted)', background: 'none', borderTop: 'none', borderLeft: 'none', borderRight: 'none', cursor: 'pointer', fontWeight: 600 }}
        >
          <Webhook size={16} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} /> Incoming Webhooks
        </button>
        <button
          className={`tab-button ${activeTab === 'apps' ? 'active' : ''}`}
          onClick={() => setActiveTab('apps')}
          style={{ padding: '8px 0', borderBottom: activeTab === 'apps' ? '2px solid var(--mm-link-color)' : '2px solid transparent', color: activeTab === 'apps' ? 'var(--mm-link-color)' : 'var(--mm-muted)', background: 'none', borderTop: 'none', borderLeft: 'none', borderRight: 'none', cursor: 'pointer', fontWeight: 600 }}
        >
          <AppWindow size={16} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} /> Connected Apps
        </button>
      </div>

      <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
        {error && <p className="form-error">{error}</p>}
        {loading && <p>Loading...</p>}

        {activeTab === 'webhooks' && !loading && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, gap: 12 }}>
              <div>
                <h3 style={{ margin: '0 0 8px 0' }}>Incoming Webhooks</h3>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--mm-muted)' }}>Create endpoints that external services (HR, ERP, Jira) can POST to, sending messages into your channels.</p>
              </div>
              <button className="slack-button" onClick={() => setShowWebhookForm(!showWebhookForm)}>
                <Plus size={16} style={{ marginRight: 6 }} /> New Webhook
              </button>
            </div>

            {showWebhookForm && (
              <form onSubmit={handleCreateWebhook} className="admin-table" style={{ padding: 16, marginBottom: 24, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <input name="name" className="slack-input" required placeholder="Webhook Name (e.g. 'SAP Finance Alerts')" />
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label className="admin-label">Post to Channel</label>
                    <select name="channel_id" className="slack-input" required>
                      {channels.filter(c => c.type === 'O' || c.type === 'P').map(c => (
                        <option key={c.id} value={c.id}>{c.type === 'O' ? '#' : '🔒'} {c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="admin-label">Link to App (Optional)</label>
                    <select name="app_id" className="slack-input">
                      <option value="">(No App Associated)</option>
                      {apps.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="slack-button">Create</button>
                  <button type="button" className="ghost-button" onClick={() => setShowWebhookForm(false)}>Cancel</button>
                </div>
              </form>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {webhooks.length === 0 ? <p className="muted">No webhooks configured.</p> : webhooks.map(w => (
                <div key={w.id} className="admin-table" style={{ padding: 16, borderRadius: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, gap: 12 }}>
                    <div>
                      <h4 style={{ margin: '0 0 4px 0' }}>{w.name}</h4>
                      <div style={{ fontSize: 13, color: 'var(--mm-muted)' }}>
                        Posts to <strong>#{w.channel_name}</strong> {w.app_name && <span> as <strong>{w.app_name}</strong></span>}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => handleDeleteWebhook(w.id)}
                      title="Delete webhook"
                      style={{ color: '#c5221f', padding: 6 }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div style={{ background: 'var(--mm-sidebar-hover)', padding: '8px 12px', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <code style={{ fontSize: 12, wordBreak: 'break-all', fontFamily: 'monospace' }}>
                      {buildWebhookUrl(w.secret_token)}
                    </code>
                    <button className="ghost-button" onClick={() => copyToClipboard(w.secret_token)} style={{ marginLeft: 12 }}>
                      {copiedToken === w.secret_token ? <Check size={16} color="green" /> : <Copy size={16} />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'apps' && !loading && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: '0 0 8px 0' }}>Connected Apps</h3>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--mm-muted)' }}>Register bot profiles with custom icons to act as senders for your webhooks.</p>
              </div>
              <button className="slack-button" onClick={() => setShowAppForm(!showAppForm)}>
                <Plus size={16} style={{ marginRight: 6 }} /> Register App
              </button>
            </div>

            {showAppForm && (
              <form onSubmit={handleCreateApp} className="admin-table" style={{ padding: 16, marginBottom: 24, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <input name="name" className="slack-input" required placeholder="App Name (e.g. 'Workday Bot')" />
                <input name="description" className="slack-input" placeholder="Short description" />
                <input name="icon_url" className="slack-input" placeholder="Icon URL (https://.../icon.png)" />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="slack-button">Register</button>
                  <button type="button" className="ghost-button" onClick={() => setShowAppForm(false)}>Cancel</button>
                </div>
              </form>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 16 }}>
              {apps.length === 0 ? <p className="muted">No apps registered.</p> : apps.map(a => (
                <div key={a.id} className="admin-table" style={{ padding: 16, borderRadius: 6, display: 'flex', gap: 12, alignItems: 'center' }}>
                  {a.icon_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={a.icon_url} alt="" style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: 40, height: 40, borderRadius: 6, background: 'var(--mm-sidebar-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <AppWindow size={20} color="var(--mm-muted)" />
                    </div>
                  )}
                  <div>
                    <h4 style={{ margin: '0 0 4px 0' }}>{a.name}</h4>
                    {a.description && <p style={{ margin: 0, fontSize: 12, color: 'var(--mm-muted)' }}>{a.description}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
