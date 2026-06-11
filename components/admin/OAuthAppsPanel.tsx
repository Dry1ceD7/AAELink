'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api/apiClient'
import { AlertCircle, Copy, Eye, EyeOff, Plus, Trash2, Key } from 'lucide-react'
import { DataTable } from '@/components/primitives'

type OAuthApp = {
  id: string
  name: string
  client_id: string
  client_secret?: string
  redirect_uris: string[]
  scopes: string
  description: string
  icon_url: string
  is_active: boolean
  created_at: number
}

type OAuthToken = {
  id: string
  token: string
  token_type: string
  app_id: string
  user_id: string
  scope: string
  expires_at: number
  created_at: number
}

export function OAuthAppsPanel() {
  const [apps, setApps] = useState<OAuthApp[]>([])
  const [tokens, setTokens] = useState<OAuthToken[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [msgType, setMsgType] = useState<'info' | 'error'>('info')

  // Create form
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newRedirect, setNewRedirect] = useState('')
  const [newScopes, setNewScopes] = useState('chat:write,users:read')
  const [createBusy, setCreateBusy] = useState(false)
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({})

  const loadApps = useCallback(async () => {
    try {
      const res = await apiFetch('/api/oauth/access')
      if (res.ok) {
        const d = await res.json()
        setApps(d.apps || [])
        setTokens(d.tokens || [])
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadApps() }, [loadApps])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return
    setCreateBusy(true)
    setMsg('')

    try {
      const res = await apiFetch('/api/oauth/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'register_app',
          name: newName.trim(),
          description: newDesc.trim(),
          redirect_uris: newRedirect.split(',').map(u => u.trim()).filter(Boolean),
          scopes: newScopes.trim(),
        })
      })

      if (res.ok) {
        setMsg('OAuth app registered successfully')
        setMsgType('info')
        setNewName('')
        setNewDesc('')
        setNewRedirect('')
        void loadApps()
      } else {
        const d = await res.json()
        setMsg(d.error || 'Failed to create app')
        setMsgType('error')
      }
    } catch {
      setMsg('Network error')
      setMsgType('error')
    } finally {
      setCreateBusy(false)
    }
  }

  const handleRevoke = async (token: string) => {
    const res = await apiFetch('/api/oauth/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'revoke', token })
    })
    if (res.ok) {
      setMsg('Token revoked')
      setMsgType('info')
      void loadApps()
    } else {
      setMsg('Failed to revoke token')
      setMsgType('error')
    }
  }

  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text)
    setMsg('Copied to clipboard')
    setMsgType('info')
    setTimeout(() => setMsg(''), 2000)
  }

  if (loading) return <div style={{ fontSize: 13, color: 'var(--doc-muted)' }}>Loading OAuth apps...</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Key size={18} style={{ color: 'var(--aae-accent, var(--aae-link))' }} />
        <h2 className="mm-auth-section-title" style={{ margin: 0 }}>OAuth Apps & API Tokens</h2>
      </div>
      <p className="aae-auth-lead">
        Register OAuth applications and manage API access tokens for integrations.
      </p>

      {/* Active Apps */}
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Registered Apps ({apps.length})</h3>
        {apps.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--doc-muted)' }}>No OAuth apps registered yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {apps.map(app => (
              <div key={app.id} style={{
                border: '1px solid var(--mm-border-subtle)',
                padding: 16, borderRadius: 10,
                background: 'var(--mm-channel-bg)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{app.name}</div>
                    {app.description && <div style={{ fontSize: 13, color: 'var(--doc-muted)', marginTop: 2 }}>{app.description}</div>}
                  </div>
                  <span style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 8,
                    background: app.is_active ? 'rgba(46,160,67,0.15)' : 'rgba(200,0,0,0.1)',
                    color: app.is_active ? '#2ea043' : '#c00'
                  }}>
                    {app.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <div style={{ marginTop: 12, display: 'grid', gap: 6, fontSize: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 600, color: 'var(--doc-muted)', width: 80 }}>Client ID:</span>
                    <code style={{ fontSize: 11, background: 'var(--mm-bg-secondary, #f1f3f5)', padding: '2px 6px', borderRadius: 4 }}>{app.client_id}</code>
                    <button type="button" className="ghost-button" style={{ padding: 2 }} onClick={() => copyToClipboard(app.client_id)} title="Copy">
                      <Copy size={12} />
                    </button>
                  </div>
                  {app.client_secret && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 600, color: 'var(--doc-muted)', width: 80 }}>Secret:</span>
                      <code style={{ fontSize: 11, background: 'var(--mm-bg-secondary, #f1f3f5)', padding: '2px 6px', borderRadius: 4 }}>
                        {showSecret[app.id] ? app.client_secret : '••••••••••••'}
                      </code>
                      <button type="button" className="ghost-button" style={{ padding: 2 }}
                        onClick={() => setShowSecret(s => ({ ...s, [app.id]: !s[app.id] }))}>
                        {showSecret[app.id] ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                    </div>
                  )}
                  <div>
                    <span style={{ fontWeight: 600, color: 'var(--doc-muted)' }}>Scopes: </span>
                    <span>{app.scopes || 'none'}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Active Tokens */}
      {tokens.length > 0 && (
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Active Tokens ({tokens.length})</h3>
          <DataTable>
            <thead>
              <tr>
                <th>Type</th>
                <th>App</th>
                <th>Scope</th>
                <th>Expires</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tokens.map(t => (
                <tr key={t.id}>
                  <td>
                    <span style={{
                      fontSize: 11, padding: '1px 6px', borderRadius: 6,
                      background: t.token_type === 'bot' ? 'rgba(0,100,200,0.1)' : 'rgba(100,0,200,0.1)'
                    }}>
                      {t.token_type}
                    </span>
                  </td>
                  <td>{apps.find(a => a.id === t.app_id)?.name || t.app_id.slice(0, 8)}</td>
                  <td style={{ fontSize: 11 }}>{t.scope || '—'}</td>
                  <td style={{ fontSize: 11 }}>
                    {t.expires_at ? new Date(t.expires_at).toLocaleDateString() : 'Never'}
                  </td>
                  <td>
                    <button type="button" className="ghost-button" style={{ fontSize: 11, padding: '2px 6px', color: '#c00' }}
                      onClick={() => void handleRevoke(t.token)}>
                      <Trash2 size={12} /> Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      )}

      {/* Register New App */}
      <div style={{ borderTop: '1px solid var(--mm-border-subtle)', paddingTop: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
          <Plus size={14} style={{ marginRight: 4, verticalAlign: -2 }} />
          Register New OAuth App
        </h3>
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 500 }}>
          <label className="field-label" htmlFor="oauth-name">
            App Name
            <input id="oauth-name" className="slack-input" value={newName}
              onChange={e => setNewName(e.target.value)} placeholder="My Integration" required />
          </label>
          <label className="field-label" htmlFor="oauth-desc">
            Description
            <input id="oauth-desc" className="slack-input" value={newDesc}
              onChange={e => setNewDesc(e.target.value)} placeholder="What does this app do?" />
          </label>
          <label className="field-label" htmlFor="oauth-redirect">
            Redirect URIs (comma-separated)
            <input id="oauth-redirect" className="slack-input" value={newRedirect}
              onChange={e => setNewRedirect(e.target.value)} placeholder="https://myapp.com/callback" />
          </label>
          <label className="field-label" htmlFor="oauth-scopes">
            Scopes
            <input id="oauth-scopes" className="slack-input" value={newScopes}
              onChange={e => setNewScopes(e.target.value)} placeholder="chat:write,users:read" />
          </label>

          {msg && (
            <div className={`mm-auth-alert mm-auth-alert--${msgType}`} role="alert">
              {msgType === 'error' && <AlertCircle size={18} strokeWidth={2} />}
              <span>{msg}</span>
            </div>
          )}

          <button type="submit" className="slack-button" disabled={createBusy || !newName.trim()} style={{ justifySelf: 'start' }}>
            {createBusy ? 'Registering...' : 'Register App'}
          </button>
        </form>
      </div>
    </div>
  )
}
