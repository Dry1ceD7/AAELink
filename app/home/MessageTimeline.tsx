'use client'

import { useRef } from 'react'
import { Hash, Lock, Users } from 'lucide-react'
import { ChatMessage, type AppUser, displayName } from '@/components/chat/ChatMessage'
import { SystemMessage, isSystemPost } from '@/components/chat/SystemMessage'
import { Composer, type ComposerHandle } from '@/components/chat/Composer'
import { TypingIndicator } from '@/components/chat/TypingIndicator'
import { DateSeparator, JumpToDate } from '@/components/chat/DateSeparator'
import { MessageSkeleton } from '@/components/chat/MessageSkeleton'
import type { ChatPost } from '@/lib/realtime/realtime'
import type { SlashMeUser } from '@/lib/messaging/composerSlash'

interface MessageTimelineProps {
  channel: { id: string; name: string; display_name: string; type?: string; dm_peer_display?: string } | null
  channelTitle: string
  posts: ChatPost[]
  visiblePosts: ChatPost[]
  postsLoading: boolean
  olderAvailable: boolean
  olderLoading: boolean
  loadOlder: () => Promise<void>
  unreadSepId: string | null
  setUnreadSepId: (id: string | null) => void
  editingId: string | null
  setEditingId: (id: string | null) => void
  me: AppUser | null
  userMap: Record<string, AppUser>
  teamMembers: AppUser[]
  activeTeamId: string
  timelineRef: React.RefObject<HTMLDivElement | null>
  composerRef: React.RefObject<ComposerHandle | null>
  onOpenThread: (post: ChatPost) => void
  onEditMessage: (post: ChatPost) => void
  onDeleteMessage: (post: ChatPost) => void
  onForwardMessage: (post: ChatPost) => void
  onPinMessage: (post: ChatPost) => void
  onSaveEdit: (postId: string, msg: string) => Promise<void>
  onSend: (msg: string) => Promise<void>
  onReactionsUpdated: (postId: string, reactions: unknown[]) => void
  onConvertToTicket: (post: ChatPost) => Promise<void>
  onAvatarClick: (userId: string) => void
  emitTyping: () => void
  onRecordAudio: () => void
  onRecordVideo: () => void
  showJumpBottom: boolean
  newMsgCount: number
  scrollToBottom: () => void
  setShowJumpBottom: (v: boolean) => void
  setNewMsgCount: (v: number) => void
  /** Navigate to user profile by resolving @username */
  onMentionClick: (username: string) => void
  /** Navigate to route */
  navigateToTicket: (ticketId: string) => void
  /** Empty-state CTAs (audit §3.5). Callbacks are optional so single-use call sites can omit them. */
  onAddDescription?: () => void
  onAddMembers?: () => void
  onAddBookmark?: () => void
}

function formatDateLabel(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diff = today.getTime() - msgDay.getTime()
  if (diff === 0) return 'Today'
  if (diff === 86400000) return 'Yesterday'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatFullDateLabel(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diff = today.getTime() - msgDay.getTime()
  if (diff === 0) return 'Today'
  if (diff === 86400000) return 'Yesterday'
  return d.toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  })
}

export function MessageTimeline({
  channel,
  channelTitle,
  posts,
  visiblePosts,
  postsLoading,
  olderAvailable,
  olderLoading,
  loadOlder,
  unreadSepId,
  setUnreadSepId,
  editingId,
  setEditingId,
  me,
  userMap,
  teamMembers,
  activeTeamId,
  timelineRef,
  composerRef,
  onOpenThread,
  onEditMessage,
  onDeleteMessage,
  onForwardMessage,
  onPinMessage,
  onSaveEdit,
  onSend,
  onReactionsUpdated,
  onConvertToTicket,
  onAvatarClick,
  emitTyping,
  onRecordAudio,
  onRecordVideo,
  showJumpBottom,
  newMsgCount,
  scrollToBottom,
  setShowJumpBottom,
  setNewMsgCount,
  onMentionClick,
  navigateToTicket,
  onAddDescription,
  onAddMembers,
  onAddBookmark,
}: MessageTimelineProps) {
  return (
    <>
      <div className="message-timeline aae-timeline" ref={timelineRef} style={{ position: 'relative' }}>
        {/* Jump-to-date pill */}
        {posts.length > 0 && (
          <JumpToDate
            currentLabel={visiblePosts[0] ? formatDateLabel(visiblePosts[0].create_at) : ''}
            onPickDate={(yyyyMmDd) => {
              const target = new Date(`${yyyyMmDd}T00:00:00`).getTime()
              const post = posts.find((p) => p.create_at >= target)
              if (!post) return
              const el = timelineRef.current?.querySelector(`[data-message-id="${CSS.escape(post.id)}"]`)
              if (el && 'scrollIntoView' in el) {
                ;(el as HTMLElement).scrollIntoView({ block: 'start', behavior: 'smooth' })
              }
            }}
          />
        )}

        {olderAvailable ? (
          <div style={{ padding: '8px 0', textAlign: 'center' }}>
            <button type="button" className="ghost-button" disabled={olderLoading}
              onClick={() => void loadOlder()}>
              {olderLoading ? 'Loading…' : 'Load older messages'}
            </button>
          </div>
        ) : null}

        {postsLoading && posts.length === 0 && (
          <MessageSkeleton count={6} />
        )}

        {!postsLoading && posts.length === 0 && (
          <section
            className="channel-intro-block"
            style={{ padding: '40px 20px', marginTop: 'auto' }}
            aria-label="Channel introduction"
          >
            <div style={{ width: '72px', height: '72px', background: 'var(--mm-sidebar-bg)', color: 'white', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', marginBottom: '20px' }}>
              {channel?.type === 'D' ? <Users size={36} /> : channel?.type === 'P' ? <Lock size={36} /> : <Hash size={36} />}
            </div>
            <h2 style={{ margin: '0 0 10px 0', fontSize: '24px', fontWeight: 'bold' }}>
              {channel?.type === 'D'
                ? `${channel.dm_peer_display || channel.display_name || channel.name}`
                : `Welcome to #${channel?.display_name || channel?.name || 'channel'}!`}
            </h2>
            <p style={{ margin: 0, color: 'var(--mm-muted)', fontSize: '15px', lineHeight: '1.5' }}>
              {channel?.type === 'D'
                ? `This is the very beginning of your direct message history with ${channel.dm_peer_display || channel.display_name || channel.name}.`
                : `This is the start of the #${channel?.display_name || channel?.name || 'channel'} channel. Say hello below!`}
            </p>

            {/* CTA cards — only for channels (not DMs) (audit §3.5) */}
            {channel && channel.type !== 'D' && (onAddDescription || onAddMembers || onAddBookmark) && (
              <div style={{ marginTop: 28, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, maxWidth: 640 }}>
                {onAddDescription && (
                  <button
                    type="button"
                    className="ghost-button"
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left', padding: '14px 16px', gap: 4 }}
                    onClick={() => onAddDescription()}
                  >
                    <strong style={{ fontSize: 13 }}>Add a description</strong>
                    <span style={{ fontSize: 12, opacity: 0.7 }}>Tell members what this channel is for.</span>
                  </button>
                )}
                {onAddMembers && (
                  <button
                    type="button"
                    className="ghost-button"
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left', padding: '14px 16px', gap: 4 }}
                    onClick={() => onAddMembers()}
                  >
                    <strong style={{ fontSize: 13 }}>Add members</strong>
                    <span style={{ fontSize: 12, opacity: 0.7 }}>Invite teammates to join the conversation.</span>
                  </button>
                )}
                {onAddBookmark && (
                  <button
                    type="button"
                    className="ghost-button"
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left', padding: '14px 16px', gap: 4 }}
                    onClick={() => onAddBookmark()}
                  >
                    <strong style={{ fontSize: 13 }}>Add a bookmark</strong>
                    <span style={{ fontSize: 12, opacity: 0.7 }}>Pin a link, doc, or important resource.</span>
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {visiblePosts.map((post, index) => {
          const prevPost = visiblePosts[index - 1]
          const isSameUser = prevPost && prevPost.user_id === post.user_id
          const timeDiff = prevPost ? post.create_at - prevPost.create_at : Infinity
          const isCompact = Boolean(isSameUser && timeDiff < 5 * 60 * 1000)
          const postDate = new Date(post.create_at).toLocaleDateString()
          const prevDate = prevPost ? new Date(prevPost.create_at).toLocaleDateString() : null
          const showDateDivider = postDate !== prevDate

          return (
            <div key={post.id} className="message-group-wrapper">
              {unreadSepId === post.id && (
                <div className="unread-separator" onClick={() => setUnreadSepId(null)} role="button" tabIndex={0} aria-label="Clear new messages marker">
                  <span className="unread-separator-text">New messages</span>
                </div>
              )}
              {showDateDivider && (
                <DateSeparator label={formatFullDateLabel(post.create_at)} />
              )}
              {isSystemPost(post) ? (
                <SystemMessage post={post} userMap={userMap} />
              ) : editingId === post.id ? (
                <div className={`message message--editing${isCompact && !showDateDivider ? ' message--compact' : ''}`}>
                  <Composer
                    channelId={channel?.id || ''}
                    channelTitle={channel?.display_name || channel?.name || ''}
                    channelType={channel?.type}
                    me={me as SlashMeUser | null}
                    teamMembers={teamMembers}
                    onSend={msg => void onSaveEdit(post.id, msg)}
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
                  compact={isCompact && !showDateDivider}
                  onOpenThread={onOpenThread}
                  onEditMessage={onEditMessage}
                  onDeleteMessage={onDeleteMessage}
                  onForwardMessage={onForwardMessage}
                  onPinMessage={onPinMessage}
                  onAvatarClick={onAvatarClick}
                  onMentionClick={onMentionClick}
                  onConvertToTicket={onConvertToTicket}
                  onReactionsUpdated={onReactionsUpdated}
                />
              )}
            </div>
          )
        })}

        {channel ? (
          <TypingIndicator channelId={channel.id} userMap={userMap} myId={me?.id || ''} />
        ) : null}
      </div>

      {/* Jump to bottom floating button */}
      {showJumpBottom && (
        <button
          type="button"
          className="jump-to-bottom-btn"
          onClick={() => { scrollToBottom(); setShowJumpBottom(false); setNewMsgCount(0) }}
          aria-label="Jump to latest messages"
        >
          {newMsgCount > 0 ? `${newMsgCount} new message${newMsgCount > 1 ? 's' : ''} ↓` : '↓ Jump to latest'}
        </button>
      )}

      <Composer ref={composerRef} channelId={channel?.id || ''} channelTitle={channelTitle}
        channelType={channel?.type} me={me as SlashMeUser | null}
        workspaceId={activeTeamId}
        teamMembers={teamMembers} onSend={msg => void onSend(msg)}
        onDraftChange={emitTyping}
        onRecordAudio={onRecordAudio}
        onRecordVideo={onRecordVideo} />
    </>
  )
}
