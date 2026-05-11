'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/apiClient'
import { connectCollab, type ChatPost, type CollabDeletion } from '@/lib/realtime'
import { ChatMessage, type AppUser, displayName } from '@/app/components/chat/ChatMessage'
import { Composer, type ComposerHandle } from '@/app/components/chat/Composer'
import { TypingIndicator, useTypingEmitter } from '@/app/components/chat/TypingIndicator'
import type { ReactionSummary } from '@/lib/reactions'
import type { SlashMeUser } from '@/lib/composerSlash'
import { Bell, BellRing, Hash } from 'lucide-react'

interface ThreadPanelProps {
  rootPost: ChatPost
  channelTitle: string
  channelType?: string
  me: AppUser | null
  userMap: Record<string, AppUser>
  teamMembers: AppUser[]
  onClose: () => void
  onResolveUsers: (posts: ChatPost[]) => void
}

export function ThreadPanel({
  rootPost,
  channelTitle,
  channelType,
  me,
  userMap,
  teamMembers,
  onClose,
  onResolveUsers
}: ThreadPanelProps) {
  const [replies, setReplies] = useState<ChatPost[]>([])
  const [loading, setLoading] = useState(true)
  const sinceMsRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<ComposerHandle>(null)

  const { onDraftChange: emitTyping } = useTypingEmitter(rootPost.channel_id, rootPost.id)
  const [broadcastToChannel, setBroadcastToChannel] = useState(false)

  // ── Bump since watermark ───────────────────────────────────────────────
  const bumpSince = useCallback((list: ChatPost[]) => {
    for (const p of list) {
      const t = Math.max(p.create_at || 0, p.edited_at || 0)
      if (t > sinceMsRef.current) sinceMsRef.current = t
    }
  }, [])

  // ── Auto-scroll to bottom ─────────────────────────────────────────────
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }, [])

  // ── Load thread replies + collab ───────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    sinceMsRef.current = 0
    setReplies([])
    setLoading(true)

    void (async () => {
      const q = new URLSearchParams({
        channel_id: rootPost.channel_id,
        root_id: rootPost.id
      })
      const res = await apiFetch(`/api/messages?${q}`, { method: 'GET' })
      if (res.ok && !cancelled) {
        const data = (await res.json()) as { posts?: ChatPost[] }
        const list = data.posts ?? []
        setReplies(list)
        bumpSince(list)
        onResolveUsers(list)
        scrollToBottom()
      }
      if (!cancelled) setLoading(false)
    })()

    // Subscribe to collab for thread updates
    const onIncoming = (incoming: ChatPost[]) => {
      if (cancelled || incoming.length === 0) return
      const threadPosts = incoming.filter(
        p => p.root_id === rootPost.id || p.id === rootPost.id
      )
      if (threadPosts.length === 0) return
      bumpSince(threadPosts)
      onResolveUsers(threadPosts)
      setReplies(cur => {
        const map = new Map(cur.map(p => [p.id, p]))
        for (const p of threadPosts) {
          if (p.id !== rootPost.id) {
            map.set(p.id, { ...p, pending: false })
          }
        }
        return Array.from(map.values()).sort((a, b) => a.create_at - b.create_at)
      })
      scrollToBottom()
    }

    const onDeletions = (dels: CollabDeletion[]) => {
      if (cancelled || dels.length === 0) return
      const gone = new Set(dels.map(d => d.id))
      setReplies(cur => cur.filter(p => !gone.has(p.id)))
    }

    const stop = connectCollab(
      rootPost.channel_id,
      () => sinceMsRef.current,
      onIncoming,
      undefined,
      onDeletions
    )

    return () => {
      cancelled = true
      stop()
    }
  }, [rootPost.id, rootPost.channel_id, bumpSince, onResolveUsers, scrollToBottom])

  // ── Send thread reply ──────────────────────────────────────────────────
  const handleSend = useCallback(
    async (message: string) => {
      if (!message.trim() || !me) return
      const pending: ChatPost = {
        id: `pending-${crypto.randomUUID()}`,
        channel_id: rootPost.channel_id,
        user_id: me.id,
        message,
        create_at: Date.now(),
        root_id: rootPost.id,
        pending: true
      }
      setReplies(cur => [...cur, pending])
      scrollToBottom()

      const res = await apiFetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_id: rootPost.channel_id,
          message,
          root_id: rootPost.id,
          broadcast: broadcastToChannel || undefined
        })
      })
      if (res.ok) {
        const saved = (await res.json()) as ChatPost
        bumpSince([saved])
        setReplies(cur => {
          const without = cur.filter(p => p.id !== pending.id)
          const map = new Map(without.map(p => [p.id, p]))
          map.set(saved.id, { ...saved, pending: false })
          return Array.from(map.values()).sort((a, b) => a.create_at - b.create_at)
        })
      } else {
        setReplies(cur => cur.filter(p => p.id !== pending.id))
      }
    },
    [me, rootPost, bumpSince, scrollToBottom]
  )

  // ── Reactions handler ──────────────────────────────────────────────────
  const onReactionsUpdated = useCallback((messageId: string, reactions: ReactionSummary[]) => {
    setReplies(cur =>
      cur.map(p => (p.id === messageId ? { ...p, reactions } : p))
    )
  }, [])

  // ── Edit message ───────────────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null)

  const handleEditMessage = useCallback((post: ChatPost) => {
    setEditingId(post.id)
  }, [])

  const handleSaveEdit = useCallback(
    async (postId: string, newText: string) => {
      const post = replies.find(p => p.id === postId) || (rootPost.id === postId ? rootPost : null)
      if (!post || newText === null || newText.trim() === '' || newText === post.message) {
        setEditingId(null)
        return
      }
      const res = await apiFetch(`/api/messages/${postId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: newText })
      })
      if (res.ok) {
        const updated = (await res.json()) as ChatPost
        setReplies(cur =>
          cur.map(p => (p.id === updated.id ? { ...updated, pending: false } : p))
        )
      }
      setEditingId(null)
    },
    [replies, rootPost]
  )

  // ── Delete message ─────────────────────────────────────────────────────
  const [pendingDeleteMsg, setPendingDeleteMsg] = useState<ChatPost | null>(null)

  const handleDeleteMessage = useCallback(async (post: ChatPost) => {
    setPendingDeleteMsg(post)
  }, [])

  const performDeleteMsg = useCallback(async () => {
    const post = pendingDeleteMsg
    if (!post) return
    setPendingDeleteMsg(null)
    const res = await apiFetch(`/api/messages/${post.id}`, { method: 'DELETE' })
    if (res.ok) {
      const data = (await res.json()) as { deleted_ids?: string[] }
      const gone = new Set(data.deleted_ids ?? [post.id])
      setReplies(cur => cur.filter(p => !gone.has(p.id)))
    }
  }, [pendingDeleteMsg])

  const rootUser = userMap[rootPost.user_id]
  const rootLabel = rootUser ? displayName(rootUser) : rootPost.user_id.slice(0, 8)

  const [following, setFollowing] = useState(true) // Replying = auto-follow

  const toggleFollow = useCallback(async () => {
    const newVal = !following
    setFollowing(newVal)
    await apiFetch('/api/collab/thread-follow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thread_id: rootPost.id, follow: newVal })
    }).catch(() => setFollowing(!newVal))
  }, [following, rootPost.id])

  return (
    <aside className="thread-pane thread-pane--open" aria-label="Thread">
      <header>
        <strong>Thread</strong>
        <span>
          {channelType === 'D' ? '' : '# '}
          {channelTitle}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
          <button
            type="button"
            className={`mm-icon-btn${following ? ' mm-icon-btn--active' : ''}`}
            title={following ? 'Following thread — click to unfollow' : 'Follow thread'}
            aria-label={following ? 'Unfollow thread' : 'Follow thread'}
            onClick={() => void toggleFollow()}
            style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 3 }}
          >
            {following ? <BellRing size={14} /> : <Bell size={14} />}
            <span style={{ fontSize: 11 }}>{following ? 'Following' : 'Follow'}</span>
          </button>
          <button
            type="button"
            className="thread-close"
            aria-label="Close thread"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
      </header>

      <div className="thread-body" ref={scrollRef}>
        {/* Root message */}
        {editingId === rootPost.id ? (
          <div className="message message--editing">
            <Composer
              channelId={rootPost.channel_id}
              channelTitle={channelTitle}
              channelType={channelType}
              me={me as SlashMeUser | null}
              teamMembers={teamMembers}
              onSend={msg => void handleSaveEdit(rootPost.id, msg)}
              editMode
              onCancelEdit={() => setEditingId(null)}
              initialContent={rootPost.message}
            />
          </div>
        ) : (
          <ChatMessage
            post={rootPost}
            me={me}
            userMap={userMap}
            onOpenThread={() => {}}
            onEditMessage={handleEditMessage}
            onDeleteMessage={handleDeleteMessage}
            onReactionsUpdated={onReactionsUpdated}
          />
        )}

        <div className="thread-divider">
          <span>
            {rootPost.reply_count ?? replies.length}{' '}
            {(rootPost.reply_count ?? replies.length) === 1 ? 'reply' : 'replies'}
          </span>
        </div>

        {loading ? (
          <p className="thread-loading">Loading thread…</p>
        ) : (
          replies.map((post, index) => {
            const prevPost = index === 0 ? rootPost : replies[index - 1]
            const isSameUser = prevPost && prevPost.user_id === post.user_id
            const timeDiff = prevPost ? post.create_at - prevPost.create_at : Infinity
            const isCompact = Boolean(isSameUser && timeDiff < 5 * 60 * 1000)

            return (
              <div key={post.id} className="message-group-wrapper">
                {editingId === post.id ? (
                  <div className={`message message--editing${isCompact ? ' message--compact' : ''}`}>
                    <Composer
                      channelId={post.channel_id}
                      channelTitle={channelTitle}
                      channelType={channelType}
                      me={me as SlashMeUser | null}
                      teamMembers={teamMembers}
                      onSend={msg => void handleSaveEdit(post.id, msg)}
                      editMode
                      onCancelEdit={() => setEditingId(null)}
                      initialContent={post.message}
                    />
                  </div>
                ) : (
                  <ChatMessage
                    post={post}
                    me={me}
                    userMap={userMap}
                    compact={isCompact}
                    onOpenThread={() => {}}
                    onEditMessage={handleEditMessage}
                    onDeleteMessage={handleDeleteMessage}
                    onReactionsUpdated={onReactionsUpdated}
                  />
                )}
              </div>
            )
          })
        )}

        <TypingIndicator
          channelId={rootPost.channel_id}
          threadRootId={rootPost.id}
          userMap={userMap}
          myId={me?.id || ''}
        />
      </div>

      <Composer
        ref={composerRef}
        channelId={rootPost.channel_id}
        channelTitle={channelTitle}
        channelType={channelType}
        me={me as SlashMeUser | null}
        teamMembers={teamMembers}
        onSend={msg => void handleSend(msg)}
        onDraftChange={emitTyping}
        threadRootId={rootPost.id}
        placeholder="Reply…"
      />

      {/* ── "Also send to #channel" toggle (Slack parity) ───── */}
      <label style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 16px 8px', fontSize: 12,
        color: 'var(--mm-muted)', cursor: 'pointer', userSelect: 'none',
      }}>
        <input
          type="checkbox"
          checked={broadcastToChannel}
          onChange={e => setBroadcastToChannel(e.target.checked)}
          style={{ accentColor: 'var(--mm-link)', width: 14, height: 14 }}
        />
        <Hash size={11} style={{ opacity: 0.5 }} />
        Also send to #{channelTitle}
      </label>

      {/* ── Delete confirmation modal ───────────────────── */}
      {pendingDeleteMsg && (
        <div className="mm-modal-overlay" role="presentation" onClick={() => setPendingDeleteMsg(null)}>
          <div className="mm-modal" role="alertdialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            <h2>Delete reply?</h2>
            <p className="mm-editor-hint" style={{ marginTop: 8 }}>
              Are you sure you want to delete this reply? This action cannot be undone.
            </p>
            <div className="mm-modal-actions">
              <button type="button" className="ghost-button" onClick={() => setPendingDeleteMsg(null)}>Cancel</button>
              <button type="button" className="slack-button" style={{ background: '#D24B4E' }}
                onClick={() => void performDeleteMsg()}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
