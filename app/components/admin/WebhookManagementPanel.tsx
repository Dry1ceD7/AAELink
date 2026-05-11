'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, Plus, Trash2, Link2, Webhook, Send, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
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
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; status: number; duration_ms: number; error?: string } | null>(null)
  const [expandedDeliveryId, setExpandedDeliveryId] = useState<string | null>(null)
  const [deliveries, setDeliveries] = useState<{ id: string; event: string; status_code: number; error: string; duration_ms: number; created_at: number }[]>([])
  const [deliveriesLoading, setDeliveriesLoading] = useState(false)
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

  async function toggleWebhook(id: string, active: boolean) {
    // Optimistically update
    setWebhooks(prev => prev.map(w => w.id === id ? { ...w, is_active: active } : w))
    const res = await apiFetch(`/api/webhooks`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_active: active })
    })
    if (!res.ok) {
      // Revert on failure
      setWebhooks(prev => prev.map(w => w.id === id ? { ...w, is_active: !active } : w))
    }
  }

  function copyToken(id: string, token: string) {
    navigator.clipboard.writeText(token).catch(() => {})
    setCopiedId(id)
    if (copiedTimer.current) clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopiedId(null), 2000)
  }

  async function testWebhook(id: string) {
    setTestingId(id)
    setTestResult(null)
    const res = await apiFetch('/api/webhooks/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhook_id: id })
    })
    setTestingId(null)
    if (res.ok) {
      const data = await res.json() as { ok: boolean; status: number; duration_ms: number; error?: string }
      setTestResult({ id, ...data })
      setTimeout(() => setTestResult(null), 8000)
    } else {
      setTestResult({ id, ok: false, status: 0, duration_ms: 0, error: 'Request failed' })
      setTimeout(() => setTestResult(null), 8000)
    }
  }

  async function loadDeliveries(webhookId: string) {
    if (expandedDeliveryId === webhookId) {
      setExpandedDeliveryId(null)
      return
    }
    setExpandedDeliveryId(webhookId)
    setDeliveriesLoading(true)
    const res = await apiFetch(`/api/webhooks/deliveries?webhook_id=${encodeURIComponent(webhookId)}`)
    setDeliveriesLoading(false)
    if (res.ok) {
      const data = await res.json() as { deliveries: typeof deliveries }
      setDeliveries(data.deliveries || [])
    }
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
              <React.Fragment key={w.id}>
              <tr>
                <td>
                  <strong style={{ fontSize: 13 }}>{w.display_name || 'Untitled'}</strong>
                  {w.description && <br />}
                  {w.description && <span style={{ fontSize: 11, color: 'var(--mm-muted)' }}>{w.description}</span>}
                </td>
                <td>
                  <span className={`ticket-badge--${w.kind === 'incoming' ? 'open' : 'in_progress'}`}
                    style={{ padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600 }}>
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
                  <button
                    type="button"
                    className="webhook-toggle"
                    data-active={w.is_active ? 'true' : 'false'}
                    title={w.is_active ? 'Click to deactivate' : 'Click to activate'}
                    onClick={() => void toggleWebhook(w.id, !w.is_active)}
                    aria-label={w.is_active ? 'Deactivate webhook' : 'Activate webhook'}
                  />
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
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
                      <>
                        {w.kind === 'outgoing' && (
                          <button type="button" className="mm-icon-btn" title="Test delivery"
                            disabled={testingId === w.id}
                            onClick={() => void testWebhook(w.id)}
                            style={{ color: 'var(--mm-link)' }}>
                            {testingId === w.id ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
                          </button>
                        )}
                        <button type="button" className="mm-icon-btn" title="Delivery log"
                          onClick={() => void loadDeliveries(w.id)}
                          style={{ color: 'var(--mm-muted)' }}>
                          {expandedDeliveryId === w.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                        <button type="button" className="mm-icon-btn" title="Delete webhook"
                          onClick={() => setConfirmDeleteId(w.id)} style={{ color: '#d24b4e' }}>
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                  {testResult && testResult.id === w.id && (
                    <div style={{
                      marginTop: 4, fontSize: 11, padding: '3px 8px', borderRadius: 8,
                      background: testResult.ok ? 'rgba(61, 184, 135, 0.1)' : 'rgba(210, 75, 78, 0.1)',
                      color: testResult.ok ? 'var(--mm-online)' : '#d24b4e'
                    }}>
                      {testResult.ok
                        ? `✓ ${testResult.status} OK — ${testResult.duration_ms}ms`
                        : `✗ ${testResult.error || `HTTP ${testResult.status}`}`
                      }
                    </div>
                  )}
                </td>
              </tr>
              {expandedDeliveryId === w.id && (
                <tr key={`${w.id}-deliveries`}>
                  <td colSpan={6} style={{ padding: '6px 14px', background: 'var(--mm-bg-subtle)' }}>
                    {deliveriesLoading ? (
                      <div style={{ fontSize: 12, color: 'var(--mm-muted)' }}><Loader2 size={12} className="spin" /> Loading…</div>
                    ) : deliveries.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--mm-muted)' }}>No delivery attempts recorded.</div>
                    ) : (
                      <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--mm-border-subtle)' }}>
                            <th style={{ textAlign: 'left', padding: '2px 6px', fontWeight: 600 }}>Event</th>
                            <th style={{ textAlign: 'left', padding: '2px 6px', fontWeight: 600 }}>Status</th>
                            <th style={{ textAlign: 'left', padding: '2px 6px', fontWeight: 600 }}>Duration</th>
                            <th style={{ textAlign: 'left', padding: '2px 6px', fontWeight: 600 }}>Time</th>
                            <th style={{ textAlign: 'left', padding: '2px 6px', fontWeight: 600 }}>Error</th>
                          </tr>
                        </thead>
                        <tbody>
                          {deliveries.slice(0, 10).map(d => (
                            <tr key={d.id} style={{ borderBottom: '1px solid var(--mm-border-subtle)' }}>
                              <td style={{ padding: '2px 6px' }}>{d.event}</td>
                              <td style={{ padding: '2px 6px', color: d.status_code >= 200 && d.status_code < 400 ? 'var(--mm-online)' : '#d24b4e' }}>
                                {d.status_code || '—'}
                              </td>
                              <td style={{ padding: '2px 6px' }}>{d.duration_ms}ms</td>
                              <td style={{ padding: '2px 6px', color: 'var(--mm-muted)' }}>
                                {new Date(d.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </td>
                              <td style={{ padding: '2px 6px', color: '#d24b4e', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {d.error || '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </td>
                </tr>
              )}
            </React.Fragment>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
