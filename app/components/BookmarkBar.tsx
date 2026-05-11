'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bookmark, ExternalLink, Plus, Trash2, X } from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'

interface BookmarkItem {
  id: string
  channel_id: string
  title: string
  link_url: string
  emoji: string
  sort_order: number
  added_by: string
  created_at: number
}

interface Props {
  channelId: string
  channelType?: string
}

export function BookmarkBar({ channelId, channelType }: Props) {
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([])
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [emoji, setEmoji] = useState('⚓')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!channelId) return
    const res = await apiFetch(`/api/bookmarks?channel_id=${encodeURIComponent(channelId)}`)
    if (res.ok) {
      const data = (await res.json()) as { bookmarks: BookmarkItem[] }
      setBookmarks(data.bookmarks || [])
    }
  }, [channelId])

  useEffect(() => {
    void load()
    setShowForm(false)
    setError('')
  }, [load])

  async function addBookmark(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !url.trim()) return
    setSaving(true)
    setError('')
    const res = await apiFetch('/api/bookmarks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel_id: channelId,
        title: title.trim(),
        link_url: url.trim(),
        emoji: emoji || '⚓'
      })
    })
    setSaving(false)
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string }
      setError(d.error || 'Failed to add bookmark')
      return
    }
    setTitle('')
    setUrl('')
    setEmoji('⚓')
    setShowForm(false)
    void load()
  }

  async function removeBookmark(id: string) {
    await apiFetch(`/api/bookmarks?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    void load()
  }

  // Don't show bookmark bar for DMs
  if (channelType === 'D' || channelType === 'G') return null

  // Collapsed state when empty — show a subtle "Add bookmark" button
  if (bookmarks.length === 0 && !showForm) {
    return (
      <div className="bookmark-bar bookmark-bar--empty">
        <button type="button" className="bookmark-bar-add-btn" onClick={() => setShowForm(true)}>
          <Bookmark size={13} />
          <span>Add a bookmark</span>
        </button>
      </div>
    )
  }

  return (
    <div className="bookmark-bar">
      <div className="bookmark-bar-items">
        {bookmarks.map(b => (
          <div key={b.id} className="bookmark-chip" title={b.link_url}>
            <a
              href={b.link_url}
              target="_blank"
              rel="noopener noreferrer"
              className="bookmark-chip-link"
            >
              <span className="bookmark-chip-emoji">{b.emoji}</span>
              <span className="bookmark-chip-title">{b.title}</span>
              <ExternalLink size={11} className="bookmark-chip-ext" />
            </a>
            <button
              type="button"
              className="bookmark-chip-remove"
              title="Remove bookmark"
              onClick={() => void removeBookmark(b.id)}
            >
              <X size={11} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="bookmark-bar-add-btn"
          onClick={() => setShowForm(true)}
          title="Add bookmark"
        >
          <Plus size={13} />
        </button>
      </div>

      {showForm && (
        <form className="bookmark-form" onSubmit={e => void addBookmark(e)}>
          <div className="bookmark-form-row">
            <input
              className="bookmark-form-emoji"
              value={emoji}
              onChange={e => setEmoji(e.target.value.slice(0, 4))}
              title="Emoji"
              maxLength={4}
            />
            <input
              className="bookmark-form-input"
              placeholder="Bookmark title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
              autoFocus
            />
            <input
              className="bookmark-form-input bookmark-form-input--url"
              type="url"
              placeholder="https://…"
              value={url}
              onChange={e => setUrl(e.target.value)}
              required
            />
            <button type="submit" className="slack-button" disabled={saving}
              style={{ padding: '4px 12px', fontSize: 12, whiteSpace: 'nowrap' }}>
              {saving ? 'Adding…' : 'Add'}
            </button>
            <button type="button" className="mm-icon-btn" onClick={() => { setShowForm(false); setError('') }}>
              <X size={14} />
            </button>
          </div>
          {error && <div className="bookmark-form-error">{error}</div>}
        </form>
      )}
    </div>
  )
}
