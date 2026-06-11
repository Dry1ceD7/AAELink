'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { MessageRichText } from '@/lib/messaging/messageRich'
import { type ReactionSummary } from '@/lib/messaging/reactions'
import { apiFetch } from '@/lib/api/apiClient'
import type { ChatPost } from '@/lib/realtime/realtime'
import { FileAttachmentCards } from './FileAttachmentCards'
import { LinkPreview, extractPreviewUrl } from './LinkPreview'
import { MessageActions } from './MessageActions'
import { MessageReactions } from './MessageReactions'
import { formatUserTime } from '@/lib/ui/userPreferences'
import { EditHistoryModal } from './EditHistoryModal'
import { type Presence } from '@/lib/types/presence'
import { PresenceDot } from '@/components/chat/PresenceDot'
import { ReadReceipts, useMarkReadOnView } from './ReadReceipts'

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
  const rootRef = useRef<HTMLElement | null>(null)

  // Clean up hover timer on unmount
  useEffect(() => {
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
    }
  }, [])

  const isSelf = Boolean(me?.id && post.user_id === me.id)
  const alreadyReadByMe = Boolean(
    me?.id && post.read_receipts?.some(r => r.user_id === me.id)
  )

  // Mark as read once the message scrolls into view (skip self/pending/already-read).
  useMarkReadOnView(
    rootRef,
    post.id,
    Boolean(me?.id) && !isSelf && !post.pending && !alreadyReadByMe
  )

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
      ref={rootRef}
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
            position: 'relative',
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
            <span className="avatar-presence-dot-wrap" style={{ position: 'absolute', right: -1, bottom: -1 }}>
              <PresenceDot status={presence} customEmoji={u?.status_emoji} />
            </span>
          ) : null}
        </div>
      )}
      <div className="message-body-wrap" onClick={(e) => {
        // Event delegation for @mention clicks (Element guard avoids closest crash)
        const node = e.target
        const target = (node instanceof Element ? node.closest('[data-mention-username]') : null) as HTMLElement | null
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
        <MessageReactions messageId={post.id} reactions={post.reactions} reactBusy={reactBusy} toggleReaction={toggleReaction} onOpenPicker={() => setReactionPickerOpen(true)} />

        {/* ── Read receipts (reader avatar stack) ──────────────── */}
        {post.read_receipts && post.read_receipts.length > 0 ? (
          <ReadReceipts receipts={post.read_receipts} userMap={userMap} />
        ) : null}

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
