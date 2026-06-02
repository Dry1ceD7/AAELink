'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bookmark, RefreshCw, Trash2, Search, ArrowUpDown, CheckSquare, Square, XCircle } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'

interface SavedItem {
  message_id: string
  channel_id: string
  saved_at: number
  body: string
  message_created_at: number
  author_id: string
  author_username?: string
  author_first_name?: string
  author_last_name?: string
  author_avatar_url?: string
  channel_name: string
  channel_slug?: string
  channel_type?: string
  root_id?: string
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

type SortMode = 'saved_newest' | 'saved_oldest' | 'message_newest'

export function SavedItemsPanel({
  onOpenMessage
}: {
  onOpenMessage: (channelId: string, messageId?: string) => void
}) {
  const [items, setItems] = useState<SavedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<SortMode>('saved_newest')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/api/saved?limit=100')
      if (!res.ok) {
        setError('Could not load saved items.')
        return
      }
      const data = await res.json() as { items: SavedItem[] }
      setItems(data.items || [])
      setSelected(new Set())
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
      setSelected(prev => { const n = new Set(prev); n.delete(messageId); return n })
    }
  }, [])

  const bulkUnsave = useCallback(async () => {
    if (selected.size === 0) return
    setBulkBusy(true)
    try {
      await Promise.all(
        Array.from(selected).map(id =>
          apiFetch('/api/saved', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message_id: id })
          })
        )
      )
      setItems(prev => prev.filter(i => !selected.has(i.message_id)))
      setSelected(new Set())
    } finally {
      setBulkBusy(false)
    }
  }, [selected])

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  const toggleAll = () => {
    if (selected.size === filteredItems.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filteredItems.map(i => i.message_id)))
    }
  }

  // Filter + sort
  const filteredItems = useMemo(() => {
    let result = items
    if (filter.trim()) {
      const q = filter.toLowerCase()
      result = result.filter(i =>
        i.body.toLowerCase().includes(q) ||
        i.channel_name?.toLowerCase().includes(q) ||
        i.author_username?.toLowerCase().includes(q) ||
        `${i.author_first_name || ''} ${i.author_last_name || ''}`.toLowerCase().includes(q)
      )
    }
    const sorted = [...result]
    switch (sort) {
      case 'saved_oldest': sorted.sort((a, b) => a.saved_at - b.saved_at); break
      case 'message_newest': sorted.sort((a, b) => b.message_created_at - a.message_created_at); break
      default: sorted.sort((a, b) => b.saved_at - a.saved_at); break
    }
    return sorted
  }, [items, filter, sort])

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
    <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--mm-border-subtle)', flexWrap: 'wrap' }}>
        <div className="mm-forward-search" style={{ flex: '1 1 160px', minWidth: 120 }}>
          <Search size={12} />
          <input
            type="search"
            placeholder={`Search ${items.length} saved items…`}
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 12 }}
          />
        </div>
        <select className="slack-input" value={sort}
          onChange={e => setSort(e.target.value as SortMode)}
          style={{ fontSize: 11, padding: '3px 6px', width: 'auto' }}>
          <option value="saved_newest">Saved: Newest</option>
          <option value="saved_oldest">Saved: Oldest</option>
          <option value="message_newest">Message: Newest</option>
        </select>
        <button type="button" className="ghost-button" onClick={toggleAll}
          title={selected.size === filteredItems.length ? 'Deselect all' : 'Select all'}
          style={{ fontSize: 11, padding: '3px 6px', display: 'flex', alignItems: 'center', gap: 3 }}>
          {selected.size === filteredItems.length && filteredItems.length > 0
            ? <CheckSquare size={12} /> : <Square size={12} />}
          {selected.size > 0 ? `${selected.size}` : ''}
        </button>
        {selected.size > 0 && (
          <button type="button" className="ghost-button" onClick={() => void bulkUnsave()}
            disabled={bulkBusy}
            style={{ fontSize: 11, padding: '3px 8px', color: '#e86c6f', display: 'flex', alignItems: 'center', gap: 3 }}>
            <XCircle size={12} /> {bulkBusy ? 'Removing…' : `Remove ${selected.size}`}
          </button>
        )}
      </div>

      {/* Items */}
      {filteredItems.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--mm-muted)', fontSize: 13 }}>
          No saved items match "{filter}"
        </div>
      ) : (
        filteredItems.map(item => (
          <div
            key={item.message_id}
            className={selected.has(item.message_id) ? '' : 'aae-hoverable'}
            style={{
              display: 'flex', alignItems: 'flex-start', padding: '12px 16px',
              borderBottom: '1px solid var(--mm-border-subtle)',
              gap: 10,
              background: selected.has(item.message_id) ? 'rgba(0,89,150,0.04)' : 'transparent'
            }}
          >
            {/* Selection checkbox */}
            <button type="button" onClick={() => toggleSelect(item.message_id)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--mm-muted)', flexShrink: 0 }}>
              {selected.has(item.message_id) ? <CheckSquare size={14} /> : <Square size={14} />}
            </button>

            {/* Author avatar */}
            {item.author_avatar_url ? (
              <img src={item.author_avatar_url} alt="" style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0 }} />
            ) : (
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--mm-bg-secondary)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: 'var(--mm-muted)' }}>
                {(item.author_username || '?')[0].toUpperCase()}
              </div>
            )}

            <button
              type="button"
              onClick={() => onOpenMessage(item.channel_id, item.message_id)}
              style={{
                flex: 1, textAlign: 'left', background: 'transparent', border: 'none',
                cursor: 'pointer', padding: 0, minWidth: 0
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                {item.author_username && (
                  <span style={{ fontSize: 12, fontWeight: 600 }}>@{item.author_username}</span>
                )}
                <span style={{ fontSize: 11, color: 'var(--mm-link)' }}>#{item.channel_name}</span>
                {item.root_id && (
                  <span style={{ fontSize: 10, color: 'var(--mm-muted)', fontStyle: 'italic' }}>thread</span>
                )}
                <span style={{ fontSize: 11, color: 'var(--mm-muted)', marginLeft: 'auto' }}>
                  {timeAgo(item.saved_at)}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--fg)', lineHeight: 1.4 }}>
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
                padding: '4px', borderRadius: 8, color: 'var(--mm-muted)', flexShrink: 0
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#e86c6f' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--mm-muted)' }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))
      )}
    </div>
  )
}
