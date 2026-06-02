'use client'

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Hash, Lock, Search, X, Users } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'

interface BrowseChannel {
  id: string
  name: string
  display_name: string
  type: string
  purpose?: string
  header?: string
  member_count?: number
  joined?: boolean
}

interface Props {
  workspaceId: string
  open: boolean
  onClose: () => void
  onJoined: (ch: BrowseChannel) => void
}

/**
 * ChannelBrowseModal — Slack-style modal for discovering and joining
 * public channels in the workspace. Filterable by name/purpose.
 */
export const ChannelBrowseModal = memo(function ChannelBrowseModal({ workspaceId, open, onClose, onJoined }: Props) {
  const [allChannels, setAllChannels] = useState<BrowseChannel[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [joiningId, setJoiningId] = useState<string | null>(null)

  // Load all available channels for workspace
  useEffect(() => {
    if (!open || !workspaceId) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const res = await apiFetch(`/api/channels?team_id=${encodeURIComponent(workspaceId)}&include_all=true`)
        if (!res.ok) return
        const data = await res.json() as { channels?: BrowseChannel[] }
        if (!cancelled) setAllChannels(data.channels ?? [])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, workspaceId])

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return allChannels.filter(c => c.type !== 'D' && c.type !== 'G')
    return allChannels
      .filter(c => c.type !== 'D' && c.type !== 'G')
      .filter(c =>
        (c.display_name || c.name).toLowerCase().includes(q) ||
        (c.purpose || '').toLowerCase().includes(q)
      )
  }, [allChannels, query])

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
          <h2 style={{ margin: 0, fontSize: 18 }}>Browse channels</h2>
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
