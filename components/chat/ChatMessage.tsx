'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Smile, MessageSquare, Forward, Pencil, Trash2, Bookmark, BookmarkCheck, Pin, Link2, MoreVertical, Copy, Clock, EyeOff, Ticket } from 'lucide-react'
import { MessageRichText } from '@/lib/messaging/messageRich'
import { type ReactionSummary } from '@/lib/messaging/reactions'
import { apiFetch } from '@/lib/api/apiClient'
import type { ChatPost } from '@/lib/realtime/realtime'
import { EmojiPicker } from './EmojiPicker'
import { FileAttachmentCards } from './FileAttachmentCards'
import { LinkPreview, extractPreviewUrl } from './LinkPreview'
import { formatUserTime } from '@/lib/ui/userPreferences'
import { useMenuNav } from '@/lib/ui/useMenuNav'
import { EditHistoryModal } from './EditHistoryModal'
import { type Presence, presenceColor } from '@/lib/types/presence'

// ── Reaction icons (Lucide-mapped, no heavy emoji deps) ────────────────────
const REACTION_ICON: Record<string, string> = {
  thumbs_up: '👍',
  heart: '❤️',
  check: '✅',
  smile: '😊',
  eye: '👀'
}

export interface AppUser {
  id: string
  username: string
  first_name?: string
  last_name?: string
  nickname?: string
  platform_role?: string
  avatar_url?: string
  job_title?: string
  phone?: string
  timezone?: string
  status_text?: string
  status_emoji?: string
  /** Live presence for the avatar dot overlay (optional; dot hidden if absent). */
  presence?: Presence
}

export function displayName(u: AppUser): string {
  const full = `${u.first_name || ''} ${u.last_name || ''}`.trim()
  if (full) return full
  if (u.nickname) return u.nickname
  return u.username
}

interface ChatMessageProps {
  post: ChatPost
  me: AppUser | null
  userMap: Record<string, AppUser>
  onOpenThread: (post: ChatPost) => void
  onEditMessage: (post: ChatPost) => void
  onDeleteMessage: (post: ChatPost) => void
  onForwardMessage?: (post: ChatPost) => void
  onPinMessage?: (post: ChatPost) => void
  onAvatarClick?: (userId: string) => void
  onMentionClick?: (username: string) => void
  onConvertToTicket?: (post: ChatPost) => void
  onReactionsUpdated: (messageId: string, reactions: ReactionSummary[]) => void
  compact?: boolean
}

function MessageHeader({ label, time, fullDate, edited, authorId, onAuthorClick, onEditedClick }: { label: string, time: string, fullDate?: string, edited?: boolean, authorId?: string, onAuthorClick?: () => void, onEditedClick?: () => void }) {
  return (
    <div className="message-meta">
      {onAuthorClick ? (
        <button type="button" className="message-author-btn" data-hovercard-userid={authorId} onClick={onAuthorClick}>
          <strong>{label}</strong>
        </button>
      ) : (
        <strong>{label}</strong>
      )}
      <span title={fullDate || time} className="message-time">{time}</span>
      {edited ? (
        <button
          type="button"
          className="message-edited message-edited-btn"
          title="View edit history"
          aria-label="View edit history"
          onClick={onEditedClick}
        >
          (edited)
        </button>
      ) : null}
    </div>
  )
}

const MessageBody = memo(function MessageBody({ message }: { message: string }) {
  const previewUrl = extractPreviewUrl(message)
  return (
    <div className="message-content">
      <MessageRichText text={message} />
      {previewUrl ? <LinkPreview url={previewUrl} /> : null}
    </div>
  )
})

function MessageReactions({
  reactions,
  reactBusy,
  toggleReaction,
  onOpenPicker,
}: {
  reactions?: ReactionSummary[],
  reactBusy: boolean,
  toggleReaction: (k: string) => void,
  onOpenPicker?: () => void,
}) {
  if (!reactions || reactions.length === 0) return null
  return (
    <div className="reaction-row">
      {reactions.map(r => (
        <button
          key={r.key}
          type="button"
          className={`reaction-chip${r.me ? ' reaction-chip--mine' : ''}`}
          title={r.key.replace(/_/g, ' ')}
          aria-pressed={r.me}
          aria-label={`${r.key.replace(/_/g, ' ')} — ${r.count} reaction${r.count !== 1 ? 's' : ''}${r.me ? ', you reacted' : ''}`}
          onClick={() => void toggleReaction(r.key)}
          disabled={reactBusy}
        >
          <span className="reaction-emoji" aria-hidden="true">{REACTION_ICON[r.key] || r.key}</span>
          <span className="reaction-count">{r.count}</span>
        </button>
      ))}
      {onOpenPicker && (
        <button
          type="button"
          className="reaction-chip reaction-chip--add"
          title="Add a reaction"
          aria-label="Add a reaction"
          onClick={onOpenPicker}
          disabled={reactBusy}
        >
          <Smile size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

function MessageActions({
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
                const base = `${window.location.origin}${window.location.pathname}`
                const sep = window.location.search ? '&' : '?'
                void navigator.clipboard.writeText(`${base}${window.location.search}${sep}focus_msg=${post.id}`)
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

export const ChatMessage = memo(function ChatMessage({
  post,
  me,
  userMap,
  onOpenThread,
  onEditMessage,
  onDeleteMessage,
  onForwardMessage,
  onPinMessage,
  onAvatarClick,
  onMentionClick,
  onConvertToTicket,
  onReactionsUpdated,
  compact
}: ChatMessageProps) {
  const [actionsOpen, setActionsOpen] = useState(false)
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false)
  const [reactBusy, setReactBusy] = useState(false)
  const [editHistoryOpen, setEditHistoryOpen] = useState(false)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clean up hover timer on unmount
  useEffect(() => {
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
    }
  }, [])

  const isSelf = Boolean(me?.id && post.user_id === me.id)
  const u = userMap[post.user_id]
  const label = isSelf || post.pending ? 'You' : u ? displayName(u) : post.user_id.slice(0, 8)
  const initial = (u?.username || label).slice(0, 1).toUpperCase()
  const presence: Presence | undefined = u?.presence
  // `last_reply_at` may not be present on every poll shape; read defensively.
  const lastReplyAt = (post as { last_reply_at?: number }).last_reply_at
  const time = post.pending
    ? 'Sending…'
    : formatUserTime(new Date(post.create_at))
  const fullDate = post.pending ? '' : new Date(post.create_at).toLocaleString([], {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })

  const toggleReaction = useCallback(
    async (key: string) => {
      if (reactBusy || post.pending) return
      setReactBusy(true)

      // Optimistic update: toggle locally before server round-trip
      const prev = post.reactions ?? []
      const existing = prev.find(r => r.key === key)
      let optimistic: ReactionSummary[]
      if (existing?.me) {
        // Un-react: decrement count or remove
        optimistic = existing.count <= 1
          ? prev.filter(r => r.key !== key)
          : prev.map(r => r.key === key ? { ...r, count: r.count - 1, me: false } : r)
      } else if (existing) {
        // React: increment count
        optimistic = prev.map(r => r.key === key ? { ...r, count: r.count + 1, me: true } : r)
      } else {
        // New reaction
        optimistic = [...prev, { key, count: 1, me: true }]
      }
      onReactionsUpdated(post.id, optimistic)

      try {
        const res = await apiFetch('/api/messages/reactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message_id: post.id, key })
        })
        if (res.ok) {
          // Reconcile with server truth
          const data = (await res.json()) as { reactions: ReactionSummary[] }
          onReactionsUpdated(post.id, data.reactions)
        } else {
          // Revert on failure
          onReactionsUpdated(post.id, prev)
        }
      } catch {
        // Revert on network error
        onReactionsUpdated(post.id, prev)
      } finally {
        setReactBusy(false)
        setReactionPickerOpen(false)
      }
    },
    [post.id, post.pending, post.reactions, reactBusy, onReactionsUpdated]
  )

  const onMouseEnter = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    setActionsOpen(true)
  }
  const onMouseLeave = () => {
    hoverTimer.current = setTimeout(() => {
      setActionsOpen(false)
      setReactionPickerOpen(false)
    }, 200)
  }

  return (
    <article
      className={`message${post.pending ? ' message--pending' : ''}${compact ? ' message--compact' : ''}${me && post.message.includes(`@${me.username}`) ? ' message--mention-me' : ''}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={() => setActionsOpen(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) { setActionsOpen(false); setReactionPickerOpen(false) } }}
      tabIndex={-1}
      role="article"
      aria-label={`Message from ${label} at ${time}`}
      data-message-id={post.id}
    >
      {compact ? (
        <div className="message-compact-gutter" aria-hidden="true">
          <span className="compact-time">{time}</span>
        </div>
      ) : (
        <div className="avatar"
          data-hovercard-userid={post.user_id}
          style={{
            cursor: onAvatarClick ? 'pointer' : undefined,
            ...(u?.avatar_url ? {
              backgroundImage: `url(${u.avatar_url})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              color: 'transparent'
            } : {})
          }}
          onClick={() => onAvatarClick?.(post.user_id)}>
          {initial}
          {presence ? (
            <span
              className={`avatar-presence-dot avatar-presence-dot--${presence}`}
              style={{ background: presenceColor(presence) }}
            />
          ) : null}
        </div>
      )}
      <div className="message-body-wrap" onClick={(e) => {
        // Event delegation for @mention clicks
        const target = (e.target as HTMLElement).closest('[data-mention-username]') as HTMLElement | null
        if (target && onMentionClick) {
          e.stopPropagation()
          onMentionClick(target.dataset.mentionUsername!)
        }
      }}>
        {!compact && <MessageHeader label={label} time={time} fullDate={fullDate} edited={Boolean(post.edited_at)} authorId={post.user_id} onAuthorClick={onAvatarClick ? () => onAvatarClick(post.user_id) : undefined} onEditedClick={() => setEditHistoryOpen(true)} />}
        <MessageBody message={post.message} />
        {post.file_attachments && post.file_attachments.length > 0 && (
          <FileAttachmentCards attachments={post.file_attachments} />
        )}
        <MessageReactions reactions={post.reactions} reactBusy={reactBusy} toggleReaction={toggleReaction} onOpenPicker={() => setReactionPickerOpen(true)} />

        {/* ── Thread tease ─────────────────────────────────────── */}
        {!post.root_id && post.reply_count && post.reply_count > 0 ? (
          <button
            type="button"
            className="thread-tease"
            onClick={() => onOpenThread(post)}
          >
            {post.reply_count} {post.reply_count === 1 ? 'reply' : 'replies'}
            {lastReplyAt ? `, last reply ${formatUserTime(new Date(lastReplyAt))}` : ''}
          </button>
        ) : null}
      </div>

      {/* ── Hover action bar ──────────────────────────────────── */}
      {actionsOpen && !post.pending ? (
        <MessageActions 
          post={post}
          isSelf={isSelf}
          reactBusy={reactBusy}
          reactionPickerOpen={reactionPickerOpen}
          setReactionPickerOpen={setReactionPickerOpen}
          onOpenThread={onOpenThread}
          onEditMessage={onEditMessage}
          onDeleteMessage={onDeleteMessage}
          onForwardMessage={onForwardMessage}
          onPinMessage={onPinMessage}
          onConvertToTicket={onConvertToTicket}
          toggleReaction={toggleReaction}
        />
      ) : null}

      {/* ── Edit history modal ────────────────────────────────── */}
      {editHistoryOpen ? (
        <EditHistoryModal
          messageId={post.id}
          open={editHistoryOpen}
          onClose={() => setEditHistoryOpen(false)}
        />
      ) : null}
    </article>
  )
})
