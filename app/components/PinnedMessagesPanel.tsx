'use client'

import { useCallback, useEffect, useState } from 'react'
import { Pin, RefreshCw, Trash2, MessageSquare } from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'
import { MessageRichText } from '@/lib/messageRich'

interface PinnedMessage {
  message_id: string
  pinned_by: string
  pinned_at: number
  body: string
  author_id: string
  message_created_at: number
}

interface Props {
  channelId: string
  open: boolean
  onClose: () => void
  /** Map of user IDs to display names for rendering author info. */
  userNames: Record<string, string>
  /** Jump to the pinned message in the timeline. */
  onJumpToMessage?: (messageId: string) => void
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function snippet(body: string, max = 200): string {
  const text = body.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return text.slice(0, max) + '…'
}

export function PinnedMessagesPanel({ channelId, open, onClose, userNames, onJumpToMessage }: Props) {
  const [pins, setPins] = useState<PinnedMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!channelId) return
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch(`/api/pins?channel_id=${encodeURIComponent(channelId)}`)
      if (res.ok) {
        const data = (await res.json()) as { pins: PinnedMessage[] }
        setPins(data.pins || [])
      } else {
        setError('Could not load pinned messages.')
      }
    } catch {
      setError('Could not load pinned messages.')
    } finally {
      setLoading(false)
    }
  }, [channelId])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const unpin = useCallback(async (messageId: string) => {
    const res = await apiFetch('/api/pins', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_id: channelId, message_id: messageId })
    })
    if (res.ok) {
      setPins(prev => prev.filter(p => p.message_id !== messageId))
    }
  }, [channelId])

  if (!open) return null

  return (
    <aside className="pinned-panel" role="complementary" aria-label="Pinned messages">
      <header className="pinned-panel-header">
        <Pin size={16} />
        <h2>Pinned Messages</h2>
        <span className="pinned-panel-count">{pins.length}</span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="mm-icon-btn"
          onClick={onClose}
          aria-label="Close pinned messages"
        >
          ✕
        </button>
      </header>

      <div className="pinned-panel-body">
        {loading && (
          <div className="pinned-panel-status">
            <RefreshCw size={18} className="spin" /> Loading…
          </div>
        )}

        {!loading && error && (
          <div className="pinned-panel-status">
            <p>{error}</p>
            <button type="button" className="ghost-button" onClick={() => void load()}>
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        )}

        {!loading && !error && pins.length === 0 && (
          <div className="pinned-panel-empty">
            <Pin size={36} strokeWidth={1.5} />
            <h3>No pinned messages</h3>
            <p>Pin important messages in this channel for easy access.</p>
          </div>
        )}

        {!loading && pins.length > 0 && pins.map(pin => (
          <div key={pin.message_id} className="pinned-card">
            <div className="pinned-card-header">
              <strong className="pinned-card-author">
                {userNames[pin.author_id] || 'Unknown'}
              </strong>
              <span className="pinned-card-time">
                {timeAgo(pin.message_created_at)}
              </span>
            </div>
            <div className="pinned-card-body">
              <MessageRichText text={snippet(pin.body)} />
            </div>
            <div className="pinned-card-actions">
              {onJumpToMessage && (
                <button
                  type="button"
                  className="ghost-button pinned-card-jump"
                  onClick={() => onJumpToMessage(pin.message_id)}
                >
                  <MessageSquare size={12} /> Jump
                </button>
              )}
              <button
                type="button"
                className="ghost-button pinned-card-unpin"
                onClick={() => void unpin(pin.message_id)}
              >
                <Trash2 size={12} /> Unpin
              </button>
            </div>
            <div className="pinned-card-footer">
              Pinned {timeAgo(pin.pinned_at)} by {userNames[pin.pinned_by] || 'someone'}
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
