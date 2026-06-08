'use client'

import { useCallback, useEffect, useState } from 'react'
import { Calendar, Clock, Loader2, Save, Trash2, X } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import { toast } from '@/lib/ui/toast'

/* ── Scheduled Messages Panel ──────────────────────────────────────
   Lists the signed-in user's pending scheduled messages from
   GET /api/messages/scheduled and wires cancel + edit to the real
   endpoints. Edit is a cancel-and-reschedule (the route exposes no
   PATCH): DELETE the old item, then POST a fresh one with new body.
   Self-contained — mount from a timeline/parent via { open, onClose }.
   ──────────────────────────────────────────────────────────────── */

interface ScheduledMsg {
  id: string
  channel_id: string
  body: string
  send_at: number
  status: string
  created_at: number
  channel_name?: string
  channel_display?: string
}

export interface ScheduledMessagesPanelProps {
  open: boolean
  onClose: () => void
  /** When set, only messages for this channel are shown. */
  channelId?: string
}

function channelLabel(m: ScheduledMsg): string {
  return m.channel_display || m.channel_name || 'Channel'
}

export function ScheduledMessagesPanel({ open, onClose, channelId }: ScheduledMessagesPanelProps) {
  const [items, setItems] = useState<ScheduledMsg[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await apiFetch('/api/messages/scheduled')
      if (!res.ok) {
        setError(true)
        return
      }
      const data = (await res.json()) as { scheduled?: ScheduledMsg[] }
      const all = data.scheduled || []
      setItems(channelId ? all.filter((m) => m.channel_id === channelId) : all)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [channelId])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const cancelMessage = useCallback(async (id: string) => {
    setBusyId(id)
    try {
      const res = await apiFetch('/api/messages/scheduled', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scheduled_id: id }),
      })
      if (!res.ok) {
        toast.error('Could not cancel scheduled message')
        return
      }
      setItems((prev) => prev.filter((m) => m.id !== id))
      toast.success('Scheduled message canceled')
    } catch {
      toast.error('Could not cancel scheduled message')
    } finally {
      setBusyId(null)
    }
  }, [])

  const startEdit = useCallback((m: ScheduledMsg) => {
    setEditingId(m.id)
    setEditBody(m.body)
  }, [])

  // Edit = cancel-and-reschedule: DELETE the old item, then POST a new
  // one with the same channel/send_at but the edited body.
  const saveEdit = useCallback(async (m: ScheduledMsg) => {
    const next = editBody.trim()
    if (!next) {
      toast.error('Message cannot be empty')
      return
    }
    setBusyId(m.id)
    try {
      const del = await apiFetch('/api/messages/scheduled', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scheduled_id: m.id }),
      })
      if (!del.ok) {
        toast.error('Could not update scheduled message')
        return
      }
      const res = await apiFetch('/api/messages/scheduled', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel_id: m.channel_id, body: next, send_at: m.send_at }),
      })
      if (!res.ok) {
        toast.error('Could not update scheduled message')
        await load()
        return
      }
      const data = (await res.json()) as { scheduled?: ScheduledMsg }
      const created = data.scheduled
      setItems((prev) =>
        prev.map((it) =>
          it.id === m.id ? { ...it, id: created?.id || it.id, body: next } : it
        )
      )
      setEditingId(null)
      setEditBody('')
      toast.success('Scheduled message updated')
    } catch {
      toast.error('Could not update scheduled message')
    } finally {
      setBusyId(null)
    }
  }, [editBody, load])

  if (!open) return null

  return (
    <div className="scheduled-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--mm-main-bg)', color: 'var(--mm-text)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--mm-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #4361EE, #3730a3)', display: 'grid', placeItems: 'center' }}>
            <Clock size={18} color="#fff" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Scheduled</h2>
            <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>
              {items.length} pending message{items.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close scheduled messages"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}>
          <X size={18} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60, opacity: 0.5 }}>
            <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 13, marginTop: 8 }}>Loading scheduled messages…</span>
          </div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: 60, opacity: 0.7 }}>
            <Calendar size={36} style={{ marginBottom: 12 }} />
            <p style={{ margin: '0 0 12px' }}>Could not load scheduled messages</p>
            <button type="button" className="ghost-button" onClick={() => void load()}>Try again</button>
          </div>
        ) : items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, opacity: 0.5 }}>
            <Calendar size={36} style={{ marginBottom: 12 }} />
            <p style={{ margin: '0 0 4px' }}>No scheduled messages</p>
            <p style={{ fontSize: 12, margin: 0 }}>Use Schedule send in the composer to queue messages</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map((m) => (
              <div key={m.id} style={{ padding: 14, borderRadius: 12, border: '1px solid var(--mm-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 13, color: '#4361EE' }}>{channelLabel(m)}</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button type="button" onClick={() => startEdit(m)} title="Edit" disabled={busyId === m.id}
                      style={{ background: 'var(--mm-hover-bg)', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: busyId === m.id ? 'default' : 'pointer', color: 'var(--mm-text)', display: 'grid', placeItems: 'center' }}>
                      <Save size={13} />
                    </button>
                    <button type="button" onClick={() => void cancelMessage(m.id)} title="Cancel" disabled={busyId === m.id}
                      style={{ background: 'none', border: 'none', cursor: busyId === m.id ? 'default' : 'pointer', color: '#e01e5a', padding: 4, display: 'grid', placeItems: 'center' }}>
                      {busyId === m.id ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={13} />}
                    </button>
                  </div>
                </div>
                {editingId === m.id ? (
                  <div>
                    <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)}
                      aria-label="Edit scheduled message"
                      style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 14, resize: 'vertical', minHeight: 72, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
                    />
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <button type="button" onClick={() => void saveEdit(m)} disabled={busyId === m.id}
                        style={{ background: '#4361EE', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Save size={12} /> Save
                      </button>
                      <button type="button" onClick={() => { setEditingId(null); setEditBody('') }}
                        style={{ background: 'var(--mm-hover-bg)', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--mm-text)' }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <p style={{ margin: '0 0 8px', fontSize: 14, lineHeight: 1.6, opacity: 0.85, whiteSpace: 'pre-wrap' }}>{m.body}</p>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#f59e0b' }}>
                  <Clock size={12} />
                  <span style={{ fontWeight: 600 }}>Sends {new Date(m.send_at).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default ScheduledMessagesPanel
