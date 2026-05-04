'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bookmark, RefreshCw, Trash2 } from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'

interface SavedItem {
  message_id: string
  channel_id: string
  saved_at: number
  body: string
  message_created_at: number
  author_id: string
  channel_name: string
}

function snippet(html: string, max = 160): string {
  const text = html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return text.slice(0, max) + '…'
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function SavedItemsPanel({
  onOpenMessage
}: {
  onOpenMessage: (channelId: string, messageId?: string) => void
}) {
  const [items, setItems] = useState<SavedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/api/saved')
      if (!res.ok) {
        setError('Could not load saved items.')
        return
      }
      const data = await res.json() as { items: SavedItem[] }
      setItems(data.items || [])
    } catch {
      setError('Could not load saved items.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const unsave = useCallback(async (messageId: string) => {
    const res = await apiFetch('/api/saved', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: messageId })
    })
    if (res.ok) {
      setItems(prev => prev.filter(i => i.message_id !== messageId))
    }
  }, [])

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mm-muted)' }}>
        <p className="module-loading">Loading saved items…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mm-muted)', flexDirection: 'column', gap: 12 }}>
        <p>{error}</p>
        <button type="button" className="ghost-button" onClick={() => void load()}>
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mm-muted)' }}>
        <div style={{ textAlign: 'center' }}>
          <Bookmark size={48} style={{ opacity: 0.4, marginBottom: 16 }} />
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--fg)' }}>No saved items</h2>
          <p style={{ maxWidth: 320, margin: '0 auto' }}>
            Click the bookmark icon on any message to save it here for quick access.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '0' }}>
      {items.map(item => (
        <div
          key={item.message_id}
          style={{
            display: 'flex', alignItems: 'flex-start', padding: '14px 20px',
            borderBottom: '1px solid var(--mm-border-subtle)',
            transition: 'background 0.15s', gap: 12
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(128,128,128,0.05)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
        >
          <button
            type="button"
            onClick={() => onOpenMessage(item.channel_id, item.message_id)}
            style={{
              flex: 1, textAlign: 'left', background: 'transparent', border: 'none',
              cursor: 'pointer', padding: 0, minWidth: 0
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--mm-link)', fontWeight: 600 }}>#{item.channel_name}</span>
              <span style={{ fontSize: 12, color: 'var(--mm-muted)' }}>
                Saved {timeAgo(item.saved_at)}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--fg)', lineHeight: 1.4 }}>
              {snippet(item.body)}
            </p>
          </button>
          <button
            type="button"
            title="Remove from saved"
            aria-label="Remove from saved"
            onClick={() => void unsave(item.message_id)}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: '4px', borderRadius: 4, color: 'var(--mm-muted)', flexShrink: 0
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#e86c6f' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--mm-muted)' }}
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
    </div>
  )
}
