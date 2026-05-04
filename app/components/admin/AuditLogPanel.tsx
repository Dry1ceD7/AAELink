'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/apiClient'

interface AuditEntry {
  id: string
  actor_id: string
  actor_username?: string
  actor_role: string
  action: string
  resource_kind: string
  resource_id: string
  ip_address: string
  metadata: Record<string, unknown>
  created_at: number
}

export function AuditLogPanel() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 30

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
    })
    if (filter) params.set('action', filter)
    const res = await apiFetch(`/api/admin/audit-log?${params.toString()}`)
    setLoading(false)
    if (!res.ok) {
      setError('Failed to load audit log')
      return
    }
    const data = await res.json()
    setEntries((data.entries || []) as AuditEntry[])
  }, [page, filter])

  useEffect(() => { void load() }, [load])

  const actionLabel = (a: string) => {
    const map: Record<string, string> = {
      'user.create': '👤 User Created',
      'user.update_role': '🔑 Role Changed',
      'user.login': '🔓 Login',
      'channel.create': '#️⃣ Channel Created',
      'channel.archive': '📦 Channel Archived',
      'message.delete': '🗑️ Message Deleted',
      'ticket.create': '🎫 Ticket Created',
      'ticket.update': '🎫 Ticket Updated',
      'webhook.create': '🔗 Webhook Created',
      'document.upload': '📄 Document Uploaded',
      'document.delete': '📄 Document Deleted',
      'approval.review': '✅ Workflow Reviewed',
    }
    return map[a] || a
  }

  return (
    <div className="admin-section">
      <h3 style={{ margin: '0 0 12px' }}>Audit Log</h3>
      <p className="mm-editor-hint" style={{ marginBottom: 12 }}>
        All administrative actions are logged here for compliance and security review.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <select className="slack-input" value={filter} onChange={e => { setFilter(e.target.value); setPage(0) }}
          style={{ width: 180, fontSize: 13 }}>
          <option value="">All actions</option>
          <option value="user.create">User Created</option>
          <option value="user.update_role">Role Changed</option>
          <option value="user.login">Login</option>
          <option value="channel.create">Channel Created</option>
          <option value="channel.archive">Channel Archived</option>
          <option value="message.delete">Message Deleted</option>
          <option value="ticket.create">Ticket Created</option>
          <option value="ticket.update">Ticket Updated</option>
          <option value="webhook.create">Webhook Created</option>
          <option value="approval.review">Workflow Reviewed</option>
        </select>
        <button type="button" className="ghost-button" onClick={() => void load()} style={{ fontSize: 13 }}>
          ↻ Refresh
        </button>
      </div>

      {error && <p className="form-error">{error}</p>}

      <table className="admin-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Action</th>
            <th>Actor</th>
            <th>Resource</th>
            <th>IP</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={5} style={{ textAlign: 'center', padding: 16 }}>Loading…</td></tr>
          ) : entries.length === 0 ? (
            <tr><td colSpan={5} style={{ textAlign: 'center', padding: 16, color: 'var(--mm-muted)' }}>No audit entries found.</td></tr>
          ) : (
            entries.map(e => (
              <tr key={e.id}>
                <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                  {new Date(e.created_at).toLocaleString()}
                </td>
                <td>
                  <span style={{ fontSize: 13 }}>{actionLabel(e.action)}</span>
                </td>
                <td style={{ fontSize: 13 }}>
                  {e.actor_username || e.actor_id?.slice(0, 8) || '—'}
                  {e.actor_role ? <span style={{ marginLeft: 4, fontSize: 11, color: 'var(--mm-muted)' }}>({e.actor_role})</span> : null}
                </td>
                <td style={{ fontSize: 12, color: 'var(--mm-muted)' }}>
                  {e.resource_kind}{e.resource_id ? `: ${e.resource_id.slice(0, 12)}…` : ''}
                </td>
                <td style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--mm-muted)' }}>
                  {e.ip_address || '—'}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, alignItems: 'center' }}>
        <button type="button" className="ghost-button" disabled={page === 0} onClick={() => setPage(p => p - 1)}
          style={{ fontSize: 13 }}>← Previous</button>
        <span style={{ fontSize: 12, color: 'var(--mm-muted)' }}>Page {page + 1}</span>
        <button type="button" className="ghost-button" disabled={entries.length < PAGE_SIZE}
          onClick={() => setPage(p => p + 1)} style={{ fontSize: 13 }}>Next →</button>
      </div>
    </div>
  )
}
