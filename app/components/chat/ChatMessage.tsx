'use client'

import { memo, useCallback, useRef, useState } from 'react'
import { Smile, MessageSquare, Forward, Pencil, Trash2 } from 'lucide-react'
import { MessageRichText } from '@/lib/messageRich'
import { REACTION_KEYS, type ReactionSummary } from '@/lib/reactions'
import { apiFetch } from '@/lib/apiClient'
import type { ChatPost } from '@/lib/realtime'

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
  onReactionsUpdated: (messageId: string, reactions: ReactionSummary[]) => void
  compact?: boolean
}

function MessageHeader({ label, time, edited }: { label: string, time: string, edited?: boolean }) {
  return (
    <div className="message-meta">
      <strong>{label}</strong>
      <span>{time}</span>
      {edited ? <span className="message-edited">(edited)</span> : null}
    </div>
  )
}

const MessageBody = memo(function MessageBody({ message }: { message: string }) {
  return (
    <div className="message-content">
      <MessageRichText text={message} />
    </div>
  )
})

function MessageReactions({
  reactions,
  reactBusy,
  toggleReaction
}: {
  reactions?: ReactionSummary[],
  reactBusy: boolean,
  toggleReaction: (k: string) => void
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
          onClick={() => void toggleReaction(r.key)}
          disabled={reactBusy}
        >
          <span className="reaction-emoji">{REACTION_ICON[r.key] || r.key}</span>
          <span className="reaction-count">{r.count}</span>
        </button>
      ))}
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
  toggleReaction: (k: string) => void
}) {
  return (
    <div className="message-actions-bar" role="toolbar" aria-label="Message actions">
      <button
        type="button"
        title="Add reaction"
        onClick={() => setReactionPickerOpen(o => !o)}
      >
        <Smile size={16} />
      </button>
      {!post.root_id ? (
        <button
          type="button"
          title="Reply in thread"
          onClick={() => onOpenThread(post)}
        >
          <MessageSquare size={16} />
        </button>
      ) : null}
      <button
        type="button"
        title="Forward message"
        onClick={() => onForwardMessage?.(post)}
      >
        <Forward size={16} />
      </button>
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
        <div className="reaction-picker" role="menu">
          {REACTION_KEYS.map(k => (
            <button
              key={k}
              type="button"
              className="reaction-pick"
              title={k.replace(/_/g, ' ')}
              disabled={reactBusy}
              onClick={() => void toggleReaction(k)}
            >
              {REACTION_ICON[k] || k}
            </button>
          ))}
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
  onReactionsUpdated,
  compact
}: ChatMessageProps) {
  const [actionsOpen, setActionsOpen] = useState(false)
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false)
  const [reactBusy, setReactBusy] = useState(false)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isSelf = Boolean(me?.id && post.user_id === me.id)
  const u = userMap[post.user_id]
  const label = isSelf || post.pending ? 'You' : u ? displayName(u) : post.user_id.slice(0, 8)
  const initial = (u?.username || label).slice(0, 1).toUpperCase()
  const time = post.pending
    ? 'Sending…'
    : new Date(post.create_at).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
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
      className={`message${post.pending ? ' message--pending' : ''}${compact ? ' message--compact' : ''}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      data-message-id={post.id}
    >
      {compact ? (
        <div className="message-compact-gutter" aria-hidden="true">
          <span className="compact-time">{time}</span>
        </div>
      ) : (
        <div className="avatar" aria-hidden="true">
          {initial}
        </div>
      )}
      <div className="message-body-wrap">
        {!compact && <MessageHeader label={label} time={time} edited={Boolean(post.edited_at)} />}
        <MessageBody message={post.message} />
        <MessageReactions reactions={post.reactions} reactBusy={reactBusy} toggleReaction={toggleReaction} />

        {/* ── Thread tease ─────────────────────────────────────── */}
        {!post.root_id && post.reply_count && post.reply_count > 0 ? (
          <button
            type="button"
            className="thread-tease"
            onClick={() => onOpenThread(post)}
          >
            {post.reply_count} {post.reply_count === 1 ? 'reply' : 'replies'}
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
          toggleReaction={toggleReaction}
        />
      ) : null}
    </article>
  )
})
