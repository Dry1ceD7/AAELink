'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api/apiClient'
import { Webhook, AppWindow, Plus, Trash2, Copy, Check, Lock } from 'lucide-react'
import { TabList, useConfirm } from '@/components/a11y'
import { toast } from '@/lib/ui/toast'

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
  const { confirm, confirmDialog } = useConfirm()
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
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'load_failed')
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
      toast.success('Webhook created.')
      loadData()
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'webhook_create_failed') }
  }

  const handleDeleteWebhook = async (id: string) => {
    if (!(await confirm({ title: 'Delete webhook', message: 'Delete this webhook? Any external service still posting to its URL will start receiving 404s.', danger: true, confirmLabel: 'Delete' }))) return
    try {
      const res = await apiFetch(`/api/integrations/webhooks/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error || 'Failed to delete webhook')
      }
      toast.success('Webhook deleted.')
      loadData()
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'webhook_delete_failed') }
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
      toast.success('App registered.')
      loadData()
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'app_register_failed') }
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
    <>
    <div className="integ-panel">
      <TabList
        tabs={[
          { id: 'webhooks', label: <><Webhook size={16} /> Incoming Webhooks</> },
          { id: 'apps', label: <><AppWindow size={16} /> Connected Apps</> },
        ]}
        value={activeTab}
        onChange={id => setActiveTab(id as Tab)}
        ariaLabel="Integrations sections"
        idPrefix="integrations"
        className="aae-tab-bar"
      />

      <div className="integ-body">
        {error && <p className="form-error">{error}</p>}
        {loading && <p>Loading...</p>}

        {activeTab === 'webhooks' && !loading && (
          <div>
            <div className="integ-section-header">
              <div>
                <h3 className="integ-section-title">Incoming Webhooks</h3>
                <p className="integ-section-desc">Create endpoints that external services (HR, ERP, Jira) can POST to, sending messages into your channels.</p>
              </div>
              <button className="slack-button" onClick={() => setShowWebhookForm(!showWebhookForm)}>
                <Plus size={16} className="integ-btn-icon" /> New Webhook
              </button>
            </div>

            {showWebhookForm && (
              <form onSubmit={handleCreateWebhook} className="admin-table integ-form">
                <input name="name" className="slack-input" required placeholder="Webhook Name (e.g. 'SAP Finance Alerts')" />
                <div className="integ-form-row">
                  <div className="integ-form-field">
                    <label className="admin-label">Post to Channel</label>
                    <select name="channel_id" className="slack-input" required>
                      {channels.filter(c => c.type === 'O' || c.type === 'P').map(c => (
                        <option key={c.id} value={c.id}>{c.type === 'O' ? '# ' : '⁍ '}{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="integ-form-field">
                    <label className="admin-label">Link to App (Optional)</label>
                    <select name="app_id" className="slack-input">
                      <option value="">(No App Associated)</option>
                      {apps.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="integ-form-actions">
                  <button type="submit" className="slack-button">Create</button>
                  <button type="button" className="ghost-button" onClick={() => setShowWebhookForm(false)}>Cancel</button>
                </div>
              </form>
            )}

            <div className="integ-card-list">
              {webhooks.length === 0 ? <p className="muted">No webhooks configured.</p> : webhooks.map(w => (
                <div key={w.id} className="admin-table integ-card">
                  <div className="integ-card-header">
                    <div>
                      <h4 className="integ-card-title">{w.name}</h4>
                      <div className="integ-card-meta">
                        Posts to <strong>#{w.channel_name}</strong> {w.app_name && <span> as <strong>{w.app_name}</strong></span>}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="ghost-button integ-delete-btn"
                      onClick={() => handleDeleteWebhook(w.id)}
                      title="Delete webhook"
                      aria-label="Delete webhook"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="integ-token-row">
                    <code className="integ-token-code">
                      {buildWebhookUrl(w.secret_token)}
                    </code>
                    <button className="ghost-button integ-copy-btn" onClick={() => copyToClipboard(w.secret_token)}>
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
            <div className="integ-section-header">
              <div>
                <h3 className="integ-section-title">Connected Apps</h3>
                <p className="integ-section-desc">Register bot profiles with custom icons to act as senders for your webhooks.</p>
              </div>
              <button className="slack-button" onClick={() => setShowAppForm(!showAppForm)}>
                <Plus size={16} className="integ-btn-icon" /> Register App
              </button>
            </div>

            {showAppForm && (
              <form onSubmit={handleCreateApp} className="admin-table integ-form">
                <input name="name" className="slack-input" required placeholder="App Name (e.g. 'Workday Bot')" />
                <input name="description" className="slack-input" placeholder="Short description" />
                <input name="icon_url" className="slack-input" placeholder="Icon URL (https://.../icon.png)" />
                <div className="integ-form-actions">
                  <button type="submit" className="slack-button">Register</button>
                  <button type="button" className="ghost-button" onClick={() => setShowAppForm(false)}>Cancel</button>
                </div>
              </form>
            )}

            <div className="integ-app-grid">
              {apps.length === 0 ? <p className="muted">No apps registered.</p> : apps.map(a => (
                <div key={a.id} className="admin-table integ-app-card">
                  {a.icon_url ? (
                    <img src={a.icon_url} alt="" className="integ-app-icon" />
                  ) : (
                    <div className="integ-app-icon-placeholder">
                      <AppWindow size={20} color="var(--mm-muted)" />
                    </div>
                  )}
                  <div>
                    <h4 className="integ-card-title">{a.name}</h4>
                    {a.description && <p className="integ-app-desc">{a.description}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
    {confirmDialog}
    </>
  )
}
