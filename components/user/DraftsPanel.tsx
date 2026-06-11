'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api/apiClient'
import { FileText, Clock, X, Edit3, Trash2, Send, Calendar, Loader2 } from 'lucide-react'

/* ── Drafts & Scheduled Send Panel ────────────────────────────────
   • Drafts stored in localStorage for instant offline access
   • Scheduled messages wired to /api/scheduled-messages
   ─────────────────────────────────────────────────────────────── */

interface Draft {
  id: string
  channel: string
  content: string
  lastEdited: string
  timestamp: number
}

interface ScheduledMsg {
  id: string
  channel_id: string
  channel_name?: string
  body: string
  scheduled_at: string
  timezone?: string
  created_at: string
}

const DRAFTS_KEY = 'aaelink_drafts'

function loadDraftsFromStorage(): Draft[] {
  try {
    return JSON.parse(localStorage.getItem(DRAFTS_KEY) || '[]')
  } catch { return [] }
}

function saveDraftsToStorage(drafts: Draft[]) {
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts))
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? 's' : ''} ago`
  return `${Math.floor(hrs / 24)} day(s) ago`
}

export default function DraftsPanel({ onClose }: { onClose: () => void }) {
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [scheduled, setScheduled] = useState<ScheduledMsg[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'drafts' | 'scheduled'>('drafts')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    // Load drafts from localStorage
    setDrafts(loadDraftsFromStorage())
    // Load scheduled from API
    try {
      const res = await apiFetch('/api/scheduled-messages')
      if (res.ok) {
        const data = await res.json()
        setScheduled(data.messages || [])
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const deleteDraft = (id: string) => {
    const updated = drafts.filter(d => d.id !== id)
    setDrafts(updated)
    saveDraftsToStorage(updated)
  }

  const deleteScheduled = async (id: string) => {
    setScheduled(prev => prev.filter(s => s.id !== id))
    await apiFetch(`/api/scheduled-messages?id=${id}`, { method: 'DELETE' }).catch(() => {})
  }

  const startEdit = (draft: Draft) => {
    setEditingId(draft.id)
    setEditContent(draft.content)
  }

  const saveEdit = (id: string) => {
    const updated = drafts.map(d => d.id === id ? { ...d, content: editContent, lastEdited: 'Just now', timestamp: Date.now() } : d)
    setDrafts(updated)
    saveDraftsToStorage(updated)
    setEditingId(null)
    setEditContent('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--mm-main-bg)', color: 'var(--mm-text)' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--mm-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #4361EE, #3730a3)', display: 'grid', placeItems: 'center' }}>
              <FileText size={18} color="#fff" />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Drafts & Scheduled</h2>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>{drafts.length} draft{drafts.length !== 1 ? 's' : ''} · {scheduled.length} scheduled</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['drafts', 'scheduled'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '6px 16px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: tab === t ? 700 : 500, cursor: 'pointer',
              background: tab === t ? '#4361EE' : 'var(--mm-hover-bg)',
              color: tab === t ? '#fff' : 'var(--mm-text)',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              {t === 'drafts' ? <><FileText size={13} /> Drafts ({drafts.length})</> : <><Clock size={13} /> Scheduled ({scheduled.length})</>}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60, opacity: 0.5 }}>
            <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 13, marginTop: 8 }}>Loading…</span>
          </div>
        ) : tab === 'drafts' ? (
          drafts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, opacity: 0.5 }}>
              <FileText size={36} style={{ marginBottom: 12 }} />
              <p>No drafts</p>
              <p style={{ fontSize: 12 }}>Unsent messages will appear here</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {drafts.map(draft => (
                <div key={draft.id} style={{ padding: 14, borderRadius: 12, border: '1px solid var(--mm-border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: 13, color: '#4361EE' }}>{draft.channel}</span>
                      <span style={{ fontSize: 11, opacity: 0.4 }}>· Edited {draft.lastEdited || timeAgo(draft.timestamp)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => startEdit(draft)} title="Edit" style={{ background: 'var(--mm-hover-bg)', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', color: 'var(--mm-text)', display: 'grid', placeItems: 'center' }}>
                        <Edit3 size={13} />
                      </button>
                      <button onClick={() => deleteDraft(draft.id)} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e01e5a', padding: 4, display: 'grid', placeItems: 'center' }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  {editingId === draft.id ? (
                    <div>
                      <textarea value={editContent} onChange={e => setEditContent(e.target.value)}
                        style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 14, resize: 'vertical', minHeight: 80, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
                      />
                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        <button onClick={() => saveEdit(draft.id)} style={{ background: '#4361EE', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Send size={12} /> Save
                        </button>
                        <button onClick={() => setEditingId(null)} style={{ background: 'var(--mm-hover-bg)', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--mm-text)' }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, opacity: 0.85 }}>{draft.content}</p>
                  )}
                </div>
              ))}
            </div>
          )
        ) : (
          scheduled.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, opacity: 0.5 }}>
              <Calendar size={36} style={{ marginBottom: 12 }} />
              <p>No scheduled messages</p>
              <p style={{ fontSize: 12 }}>Use the scheduler in the composer to queue messages</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {scheduled.map(msg => (
                <div key={msg.id} style={{ padding: 14, borderRadius: 12, border: '1px solid var(--mm-border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: '#4361EE' }}>{msg.channel_name || 'Channel'}</span>
                    <button onClick={() => deleteScheduled(msg.id)} title="Cancel" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e01e5a', display: 'grid', placeItems: 'center' }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <p style={{ margin: '0 0 8px', fontSize: 14, lineHeight: 1.6, opacity: 0.85 }}>{msg.body}</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#f59e0b' }}>
                    <Clock size={12} />
                    <span style={{ fontWeight: 600 }}>Scheduled: {new Date(msg.scheduled_at).toLocaleString()}</span>
                    {msg.timezone && <span style={{ opacity: 0.6 }}>({msg.timezone})</span>}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}
