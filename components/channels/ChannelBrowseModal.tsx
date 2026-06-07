'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Hash, Lock, Search, X, Users } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'

interface BrowseChannel {
  id: string
  name: string
  display_name: string
  type: string
  purpose?: string
  description?: string
  member_count?: number
  joined?: boolean
  is_org_wide?: boolean
}

interface Props {
  workspaceId: string
  open: boolean
  onClose: () => void
  onJoined: (ch: BrowseChannel) => void
}

const DEBOUNCE_MS = 300

/**
 * ChannelBrowseModal — Slack-style modal for discovering and joining
 * public channels in the workspace. Search is server-side via
 * /api/search/channels (debounced), with member_count + joined state
 * returned from the server.
 */
export const ChannelBrowseModal = memo(function ChannelBrowseModal({ workspaceId, open, onClose, onJoined }: Props) {
  const [channels, setChannels] = useState<BrowseChannel[]>([])
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [joiningId, setJoiningId] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fetch from server whenever open/workspaceId/query changes (debounced on query)
  useEffect(() => {
    if (!open || !workspaceId) return
    let cancelled = false

    const doFetch = (q: string) => {
      setLoading(true)
      void (async () => {
        try {
          const params = new URLSearchParams({ workspace_id: workspaceId, limit: '50', offset: '0' })
          if (q) params.set('q', q)
          const res = await apiFetch(`/api/search/channels?${params.toString()}`)
          if (!res.ok) return
          const data = await res.json() as { channels?: BrowseChannel[]; total?: number }
          if (!cancelled) {
            setChannels(data.channels ?? [])
            setTotal(data.total ?? 0)
          }
        } finally {
          if (!cancelled) setLoading(false)
        }
      })()
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doFetch(query), query ? DEBOUNCE_MS : 0)

    return () => {
      cancelled = true
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [open, workspaceId, query])

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setQuery('')
      setChannels([])
      setTotal(0)
    }
  }, [open])

  const filtered = channels

  const handleJoin = useCallback(async (ch: BrowseChannel) => {
    setJoiningId(ch.id)
    try {
      await apiFetch('/api/channels/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_name: ch.name }),
      })
      onJoined(ch)
    } finally {
      setJoiningId(null)
    }
  }, [onJoined])

  if (!open) return null

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div className="modal-panel slack-card channel-browse-modal" role="dialog" aria-modal="true"
        onClick={e => e.stopPropagation()} style={{ maxWidth: 640, width: '90vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>
            Browse channels{total > 0 && !loading ? <span style={{ fontWeight: 400, fontSize: 14, color: 'var(--mm-muted)', marginLeft: 8 }}>{total} channel{total !== 1 ? 's' : ''}</span> : null}
          </h2>
          <button type="button" className="mm-icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Search input */}
        <div className="channel-browse-search">
          <Search size={16} style={{ color: 'var(--mm-muted)', flexShrink: 0 }} />
          <input
            className="slack-input"
            type="text"
            placeholder="Search channels…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
            style={{ border: 'none', background: 'none', flex: 1, padding: '6px 0' }}
          />
        </div>

        {/* Channel list */}
        <div className="channel-browse-list" style={{ flex: 1, overflowY: 'auto', marginTop: 12 }}>
          {loading ? (
            <p style={{ textAlign: 'center', color: 'var(--mm-muted)', padding: '24px 0' }}>Loading channels…</p>
          ) : filtered.length === 0 ? (
            <p style={{ textAlign: 'center', color: 'var(--mm-muted)', padding: '24px 0' }}>
              {query ? 'No channels match your search.' : 'No channels available.'}
            </p>
          ) : (
            filtered.map(ch => (
              <div key={ch.id} className="channel-browse-item">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {ch.type === 'P' ? <Lock size={14} /> : <Hash size={14} />}
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{ch.display_name || ch.name}</span>
                    {ch.member_count != null && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 12, color: 'var(--mm-muted)' }}>
                        <Users size={11} /> {ch.member_count}
                      </span>
                    )}
                  </div>
                  {ch.purpose && (
                    <p style={{ margin: '2px 0 0 20px', fontSize: 12, color: 'var(--mm-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ch.purpose}
                    </p>
                  )}
                </div>
                {ch.joined ? (
                  <span className="channel-browse-joined">Joined</span>
                ) : (
                  <button
                    type="button"
                    className="slack-button channel-browse-join-btn"
                    disabled={joiningId === ch.id}
                    onClick={() => void handleJoin(ch)}
                  >
                    {joiningId === ch.id ? 'Joining…' : 'Join'}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
})
