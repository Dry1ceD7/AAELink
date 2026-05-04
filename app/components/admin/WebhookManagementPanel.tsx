'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, Plus, Trash2, Link2, Webhook } from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'

interface WebhookRow {
  id: string
  kind: string
  display_name: string
  channel_id: string | null
  channel_name?: string
  token: string
  callback_url: string
  description: string
  is_active: boolean
  created_at: number
}

interface Channel {
  id: string
  name: string
  display_name: string
}

export function WebhookManagementPanel({ workspaceId }: { workspaceId: string }) {
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [showForm, setShowForm] = useState(false)

  // Form state
  const [fKind, setFKind] = useState<'incoming' | 'outgoing'>('incoming')
  const [fName, setFName] = useState('')
  const [fDesc, setFDesc] = useState('')
  const [fChannel, setFChannel] = useState('')
  const [fCallback, setFCallback] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const [wRes, cRes] = await Promise.all([
      apiFetch(`/api/webhooks?workspace_id=${encodeURIComponent(workspaceId)}`),
      apiFetch(`/api/channels?team_id=${encodeURIComponent(workspaceId)}`)
    ])
    setLoading(false)
    if (wRes.ok) {
      const data = await wRes.json()
      setWebhooks((data.webhooks || []) as WebhookRow[])
    }
    if (cRes.ok) {
      const data = await cRes.json()
      setChannels((data.channels || []) as Channel[])
    }
  }, [workspaceId])

  useEffect(() => { void load() }, [load])

  async function createWebhook(e: React.FormEvent) {
    e.preventDefault()
    if (!fName.trim()) return
    setCreating(true)
    setError('')
    const res = await apiFetch('/api/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id: workspaceId,
        kind: fKind,
        display_name: fName.trim(),
        description: fDesc.trim(),
        channel_id: fChannel || null,
        callback_url: fCallback.trim(),
      })
    })
    setCreating(false)
    if (!res.ok) {
      setError('Failed to create webhook')
      return
    }
    setFName('')
    setFDesc('')
    setFChannel('')
    setFCallback('')
    setShowForm(false)
    void load()
  }

  async function deleteWebhook(id: string) {
    setConfirmDeleteId(null)
    await apiFetch(`/api/webhooks?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    void load()
  }

  function copyToken(id: string, token: string) {
    navigator.clipboard.writeText(token).catch(() => {})
    setCopiedId(id)
    if (copiedTimer.current) clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopiedId(null), 2000)
  }

  if (!workspaceId) return <p className="mm-editor-hint">Select a workspace first.</p>

  return (
    <div className="admin-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>
          <Webhook size={16} style={{ marginRight: 6, verticalAlign: '-2px' }} />
          Webhooks
        </h3>
        <button type="button" className="slack-button" style={{ fontSize: 13, padding: '5px 14px' }}
          onClick={() => setShowForm(v => !v)}>
          <Plus size={14} /> {showForm ? 'Cancel' : 'New Webhook'}
        </button>
      </div>
      <p className="mm-editor-hint" style={{ marginBottom: 16 }}>
        Incoming webhooks post messages to channels. Outgoing webhooks trigger HTTP callbacks on events.
      </p>

      {error && <p className="form-error" style={{ marginBottom: 8 }}>{error}</p>}

      {showForm && (
        <form onSubmit={e => void createWebhook(e)} className="admin-section"
          style={{ marginBottom: 16, padding: 14, borderRadius: 8, border: '1px solid var(--mm-border-subtle)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <label className="field-label">
              Type
              <select className="slack-input" value={fKind} onChange={e => setFKind(e.target.value as 'incoming' | 'outgoing')}>
                <option value="incoming">Incoming (post to channel)</option>
                <option value="outgoing">Outgoing (HTTP callback)</option>
              </select>
            </label>
            <label className="field-label">
              Name
              <input type="text" className="slack-input" value={fName} onChange={e => setFName(e.target.value)}
                placeholder="e.g. CI/CD Notifications" required />
            </label>
          </div>
          <label className="field-label">
            Description
            <input type="text" className="slack-input" value={fDesc} onChange={e => setFDesc(e.target.value)}
              placeholder="What this webhook does…" />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
            <label className="field-label">
              Channel
              <select className="slack-input" value={fChannel} onChange={e => setFChannel(e.target.value)}>
                <option value="">Select channel…</option>
                {channels.filter(c => (c as { type?: string }).type !== 'D').map(c => (
                  <option key={c.id} value={c.id}>#{c.display_name || c.name}</option>
                ))}
              </select>
            </label>
            {fKind === 'outgoing' && (
              <label className="field-label">
                Callback URL
                <input type="url" className="slack-input" value={fCallback} onChange={e => setFCallback(e.target.value)}
                  placeholder="https://…" />
              </label>
            )}
          </div>
          <button type="submit" className="slack-button" disabled={creating} style={{ marginTop: 12 }}>
            {creating ? 'Creating…' : 'Create Webhook'}
          </button>
        </form>
      )}

      <table className="admin-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Channel</th>
            <th>Token</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={6} style={{ textAlign: 'center', padding: 16 }}>Loading…</td></tr>
          ) : webhooks.length === 0 ? (
            <tr><td colSpan={6} style={{ textAlign: 'center', padding: 16, color: 'var(--mm-muted)' }}>
              No webhooks configured yet. Create one to get started.
            </td></tr>
          ) : (
            webhooks.map(w => (
              <tr key={w.id}>
                <td>
                  <strong style={{ fontSize: 13 }}>{w.display_name || 'Untitled'}</strong>
                  {w.description && <br />}
                  {w.description && <span style={{ fontSize: 11, color: 'var(--mm-muted)' }}>{w.description}</span>}
                </td>
                <td>
                  <span className={`ticket-badge--${w.kind === 'incoming' ? 'open' : 'in_progress'}`}
                    style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
                    {w.kind === 'incoming' ? '↓ Incoming' : '↑ Outgoing'}
                  </span>
                </td>
                <td style={{ fontSize: 13 }}>
                  {w.channel_name ? `#${w.channel_name}` : <span className="mm-editor-hint">—</span>}
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <code style={{ fontSize: 11, background: 'rgba(0,0,0,0.05)', padding: '1px 6px', borderRadius: 3 }}>
                      {w.token.slice(0, 12)}…
                    </code>
                    <button type="button" className="mm-icon-btn" title="Copy token"
                      onClick={() => copyToken(w.id, w.token)} style={{ padding: 2 }}>
                      {copiedId === w.id ? <span style={{ fontSize: 11, color: 'var(--mm-online)' }}>✓</span> : <Copy size={13} />}
                    </button>
                  </div>
                </td>
                <td>
                  <span style={{
                    fontSize: 11, fontWeight: 600,
                    color: w.is_active ? 'var(--mm-online)' : 'var(--mm-muted)'
                  }}>
                    {w.is_active ? '● Active' : '○ Inactive'}
                  </span>
                </td>
                <td>
                  {confirmDeleteId === w.id ? (
                    <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <button type="button" className="slack-button" style={{ fontSize: 11, padding: '2px 8px', background: '#d24b4e', color: '#fff' }}
                        onClick={() => void deleteWebhook(w.id)}>
                        Confirm
                      </button>
                      <button type="button" className="mm-icon-btn" style={{ fontSize: 11 }}
                        onClick={() => setConfirmDeleteId(null)}>
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="mm-icon-btn" title="Delete webhook"
                      onClick={() => setConfirmDeleteId(w.id)} style={{ color: '#d24b4e' }}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
