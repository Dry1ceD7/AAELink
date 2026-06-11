'use client'

import { useState } from 'react'
import { Smile, MessageSquare, Forward, Pencil, Trash2, Bookmark, BookmarkCheck, Pin, MoreVertical, Copy, Clock, EyeOff, Ticket, Link2 } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import type { ChatPost } from '@/lib/realtime/realtime'
import { EmojiPicker } from './EmojiPicker'
import { useMenuNav } from '@/lib/ui/useMenuNav'
import { toast } from '@/lib/ui/toast'

export function MessageActions({
  post,
  isSelf,
  reactBusy,
  reactionPickerOpen,
  setReactionPickerOpen,
  onOpenThread,
  onEditMessage,
  onDeleteMessage,
  onForwardMessage,
  onPinMessage,
  onConvertToTicket,
  toggleReaction
}: {
  post: ChatPost,
  isSelf: boolean,
  reactBusy: boolean,
  reactionPickerOpen: boolean,
  setReactionPickerOpen: React.Dispatch<React.SetStateAction<boolean>>,
  onOpenThread: (p: ChatPost) => void,
  onEditMessage: (p: ChatPost) => void,
  onDeleteMessage: (p: ChatPost) => void,
  onForwardMessage?: (p: ChatPost) => void,
  onPinMessage?: (p: ChatPost) => void,
  onConvertToTicket?: (p: ChatPost) => void,
  toggleReaction: (k: string) => void
}) {
  const [saved, setSaved] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreMenuRef = useMenuNav<HTMLDivElement>(moreOpen, () => setMoreOpen(false))
  return (
    <div className="message-actions-bar" role="toolbar" aria-label="Message actions">
      <button
        type="button"
        title="Add reaction"
        aria-label="Add reaction"
        data-testid="message-reaction-button"
        onClick={() => setReactionPickerOpen(o => !o)}
      >
        <Smile size={16} aria-hidden="true" />
      </button>
      {!post.root_id ? (
        <button
          type="button"
          title="Reply in thread"
          aria-label="Reply in thread"
          onClick={() => onOpenThread(post)}
        >
          <MessageSquare size={16} aria-hidden="true" />
        </button>
      ) : null}
      <button
        type="button"
        title={saved ? 'Saved!' : 'Save message'}
        aria-label={saved ? 'Message saved' : 'Save message'}
        aria-pressed={saved}
        className={saved ? 'message-action-saved' : undefined}
        onClick={async () => {
          await apiFetch('/api/saved', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message_id: post.id, channel_id: post.channel_id })
          })
          setSaved(true)
          setTimeout(() => setSaved(false), 1500)
        }}
      >
        {saved ? <BookmarkCheck size={16} aria-hidden="true" /> : <Bookmark size={16} aria-hidden="true" />}
      </button>
      <button
        type="button"
        title="Pin message"
        aria-label="Pin message"
        onClick={() => onPinMessage?.(post)}
      >
        <Pin size={16} aria-hidden="true" />
      </button>
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          title="More actions"
          aria-label="More message actions"
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(o => !o)}
        >
          <MoreVertical size={16} aria-hidden="true" />
        </button>
        {moreOpen && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setMoreOpen(false)} />
            <div ref={moreMenuRef} className="message-more-menu" role="menu" aria-label="More message actions">
              <button type="button" role="menuitem" onClick={() => {
                const text = post.message.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
                void navigator.clipboard.writeText(text)
                setMoreOpen(false)
              }}>
                <Copy size={14} /> Copy text
              </button>
              <button type="button" role="menuitem" onClick={() => {
                void (async () => {
                  try {
                    const res = await apiFetch(`/api/messages/permalink?message_id=${encodeURIComponent(post.id)}`)
                    if (!res.ok) { toast.error('Could not copy link'); return }
                    const data = (await res.json()) as { permalink: string }
                    await navigator.clipboard.writeText(data.permalink)
                    toast.success('Link copied')
                  } catch {
                    toast.error('Could not copy link')
                  }
                })()
                setMoreOpen(false)
              }}>
                <Link2 size={14} /> Copy link
              </button>
              <button type="button" role="menuitem" onClick={() => {
                onForwardMessage?.(post)
                setMoreOpen(false)
              }}>
                <Forward size={14} /> Forward
              </button>
              <div style={{ height: 1, background: 'var(--mm-border-subtle)', margin: '4px 0' }} />
              <button type="button" role="menuitem" onClick={() => {
                void apiFetch('/api/collab/mark-unread', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ channel_id: post.channel_id, from_create_at: post.create_at })
                })
                setMoreOpen(false)
              }}>
                <EyeOff size={14} /> Mark as unread
              </button>
              <button type="button" role="menuitem" onClick={() => {
                void apiFetch('/api/reminders', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    body: post.message.replace(/<[^>]+>/g, '').slice(0, 200),
                    message_id: post.id,
                    channel_id: post.channel_id,
                    fire_at: Date.now() + 30 * 60_000
                  })
                })
                setMoreOpen(false)
              }}>
                <Clock size={14} /> Remind me in 30m
              </button>
              <button type="button" role="menuitem" onClick={() => {
                void apiFetch('/api/reminders', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    body: post.message.replace(/<[^>]+>/g, '').slice(0, 200),
                    message_id: post.id,
                    channel_id: post.channel_id,
                    fire_at: Date.now() + 60 * 60_000
                  })
                })
                setMoreOpen(false)
              }}>
                <Clock size={14} /> Remind me in 1h
              </button>
              <button type="button" role="menuitem" onClick={() => {
                void apiFetch('/api/reminders', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    body: post.message.replace(/<[^>]+>/g, '').slice(0, 200),
                    message_id: post.id,
                    channel_id: post.channel_id,
                    fire_at: Date.now() + 4 * 60 * 60_000
                  })
                })
                setMoreOpen(false)
              }}>
                <Clock size={14} /> Remind me in 4h
              </button>
              <button type="button" role="menuitem" onClick={() => {
                // Tomorrow at 9am local time
                const tomorrow = new Date()
                tomorrow.setDate(tomorrow.getDate() + 1)
                tomorrow.setHours(9, 0, 0, 0)
                void apiFetch('/api/reminders', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    body: post.message.replace(/<[^>]+>/g, '').slice(0, 200),
                    message_id: post.id,
                    channel_id: post.channel_id,
                    fire_at: tomorrow.getTime()
                  })
                })
                setMoreOpen(false)
              }}>
                <Clock size={14} /> Tomorrow at 9am
              </button>
              <button type="button" role="menuitem" onClick={() => {
                // Next Monday at 9am local time
                const now = new Date()
                const dayOfWeek = now.getDay()
                const daysUntilMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek)
                const nextMon = new Date()
                nextMon.setDate(nextMon.getDate() + daysUntilMonday)
                nextMon.setHours(9, 0, 0, 0)
                void apiFetch('/api/reminders', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    body: post.message.replace(/<[^>]+>/g, '').slice(0, 200),
                    message_id: post.id,
                    channel_id: post.channel_id,
                    fire_at: nextMon.getTime()
                  })
                })
                setMoreOpen(false)
              }}>
                <Clock size={14} /> Next Monday at 9am
              </button>
              {onConvertToTicket && (
                <>
                  <div style={{ height: 1, background: 'var(--mm-border-subtle)', margin: '4px 0' }} />
                  <button type="button" role="menuitem" onClick={() => {
                    onConvertToTicket(post)
                    setMoreOpen(false)
                  }}>
                    <Ticket size={14} /> Convert to ticket
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
      {isSelf ? (
        <>
          <button
            type="button"
            title="Edit message"
            onClick={() => onEditMessage(post)}
          >
            <Pencil size={16} />
          </button>
          <button
            type="button"
            title="Delete message"
            onClick={() => onDeleteMessage(post)}
          >
            <Trash2 size={16} />
          </button>
        </>
      ) : null}

      {/* ── Reaction picker flyout ─────────────────────────── */}
      {reactionPickerOpen ? (
        <div className="reaction-picker-container">
          <EmojiPicker
            onSelect={(emoji) => void toggleReaction(emoji)}
            onClose={() => setReactionPickerOpen(false)}
          />
        </div>
      ) : null}
    </div>
  )
}
