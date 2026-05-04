'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Menu, Search, Hash, Lock, MessageCircle, ChevronDown, ChevronUp, Plus, MessageSquare, Bookmark, FileText, Settings, ShieldAlert, AlignLeft, Users, LogOut, UserPlus, Paintbrush, CircleDot, Info, Pin, Star, BellOff, Keyboard, CheckSquare, Book, Calendar, Puzzle, X, Package, SmilePlus, Copy, Check, Link2, GripVertical, PenLine } from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'
import { isPlatformAdmin } from '@/lib/platformRole'
import { notifyDesktopChatMessage } from '@/lib/desktopNotify'
import { playNotificationSound } from '@/lib/notificationSound'
import { connectCollab, type ChatPost, type CollabDeletion } from '@/lib/realtime'
import { cachePosts, readCachedPosts, removeCachedPosts, setChannelMeta, pruneChannel } from '@/lib/messageCache'
import { ChatMessage, type AppUser, displayName } from '@/app/components/chat/ChatMessage'
import { Composer, type ComposerHandle } from '@/app/components/chat/Composer'
import { TypingIndicator, useTypingEmitter } from '@/app/components/chat/TypingIndicator'
import { ThreadPanel } from '@/app/components/chat/ThreadPanel'
import { usePresenceHeartbeat } from '@/app/components/chat/usePresenceHeartbeat'
import { usePresenceListener } from '@/app/components/chat/usePresenceListener'
import { useReadState } from '@/app/components/chat/useReadState'
import { useVirtualTimeline } from '@/app/components/chat/useVirtualTimeline'
import { NotificationsBell } from '@/app/components/NotificationsBell'
import { CommandPalette, type CommandPaletteItem } from '@/app/components/CommandPalette'
import { NewMessageModal } from '@/app/components/NewMessageModal'
import { SearchPanel } from '@/app/components/chat/SearchPanel'
import type { ReactionSummary } from '@/lib/reactions'
import type { SlashMeUser } from '@/lib/composerSlash'
import { enqueueMessage, startOutboxFlushListener } from '@/lib/outboxQueue'
import { TicketsPanel } from '@/app/components/TicketsPanel'
import { DocumentsPanel } from '@/app/components/DocumentsPanel'
import { ApprovalsPanel } from '@/app/components/ApprovalsPanel'
import { KnowledgeBasePanel } from '@/app/components/KnowledgeBasePanel'
import { CalendarPanel } from '@/app/components/CalendarPanel'
import { IntegrationsPanel } from '@/app/components/IntegrationsPanel'
import { SsoSettingsPanel } from '@/app/components/SsoSettingsPanel'
import { ThreadsListPanel } from '@/app/components/ThreadsListPanel'
import { SavedItemsPanel } from '@/app/components/SavedItemsPanel'
import { ChannelInfoPanel } from '@/app/components/ChannelInfoPanel'
import { BookmarkBar } from '@/app/components/BookmarkBar'
import { ChannelTopicInline } from '@/app/components/chat/ChannelTopicInline'
import { PinnedMessagesPanel } from '@/app/components/PinnedMessagesPanel'
import { UpdateBanner } from '@/app/components/UpdateBanner'
import { ChannelNotifPrefsModal } from '@/app/components/ChannelNotifPrefsModal'
import { UserProfileCard } from '@/app/components/UserProfileCard'
import { KeyboardShortcutsModal } from '@/app/components/KeyboardShortcutsModal'
import { ForwardMessageModal } from '@/app/components/chat/ForwardMessageModal'
import { readStarredChannels, toggleStarChannel } from '@/lib/channelStars'
import { getChannelIdsWithDrafts } from '@/lib/messageDrafts'
import { GlobalSearchModal } from '@/app/components/GlobalSearchModal'
import { QuickSwitcher } from '@/app/components/QuickSwitcher'
import { SettingsShell } from '@/app/components/SettingsShell'
import { MarketplacePanel } from '@/app/components/MarketplacePanel'
import { ChannelHeaderDropdown } from '@/app/components/chat/ChannelHeaderDropdown'
import { ChannelBrowseModal } from '@/app/components/ChannelBrowseModal'
import { CustomEmojiPanel } from '@/app/components/CustomEmojiPanel'
import { useAutoAway } from '@/lib/useAutoAway'
import { isDndActive } from '@/lib/dndSchedule'

interface Channel {
  id: string
  name: string
  display_name: string
  team_id: string
  type?: string
  unread_count?: number
  dm_peer_display?: string
  purpose?: string
  header?: string
}

interface Team {
  id: string
  name: string
  display_name: string
}

const TEAM_KEY = 'aaelink_last_team'

function channelLabelForNotify(ch: Channel | null) {
  if (!ch) return 'Messages'
  if (ch.type === 'D') return ch.dm_peer_display || ch.display_name || ch.name
  return `#${ch.display_name || ch.name}`
}

function SidebarSection({ id, title, children, onAdd }: { id: string, title: string, children: React.ReactNode, onAdd?: () => void }) {
  const [open, setOpen] = useState(true)
  
  useEffect(() => {
    const val = localStorage.getItem(`sidebar_section_${id}`)
    if (val !== null) setOpen(val === 'true')
  }, [id])

  const handleToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    const next = e.currentTarget.open
    setOpen(next)
    localStorage.setItem(`sidebar_section_${id}`, String(next))
  }

  return (
    <details className="channel-section" open={open} onToggle={handleToggle}>
      <summary className="channel-section-head">
        <div className="section-title-wrap">
          <ChevronDown size={14} className="section-chevron" style={{ transform: open ? 'none' : 'rotate(-90deg)' }} />
          <p>{title}</p>
        </div>
        {onAdd && (
          <button type="button" className="channel-add" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAdd(); }}>
            <Plus size={16} />
          </button>
        )}
      </summary>
      {open && children}
    </details>
  )
}

function HomeChat() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeModule = searchParams.get('module') || null
  const [teams, setTeams] = useState<Team[]>([])
  const [activeTeamId, setActiveTeamId] = useState('')
  const [channels, setChannels] = useState<Channel[]>([])
  const [channel, setChannel] = useState<Channel | null>(null)
  const [posts, setPosts] = useState<ChatPost[]>([])
  const [olderAvailable, setOlderAvailable] = useState(false)
  const [olderLoading, setOlderLoading] = useState(false)
  const [streamUp, setStreamUp] = useState(false)
  const [me, setMe] = useState<AppUser | null>(null)
  const [userMap, setUserMap] = useState<Record<string, AppUser>>({})
  const [teamMembers, setTeamMembers] = useState<AppUser[]>([])
  const [newChannelOpen, setNewChannelOpen] = useState(false)
  const [newChannelDisplay, setNewChannelDisplay] = useState('')
  const [newChannelSlug, setNewChannelSlug] = useState('')
  const [newChannelPurpose, setNewChannelPurpose] = useState('')
  const [newChannelPrivate, setNewChannelPrivate] = useState(false)
  const [channelBusy, setChannelBusy] = useState(false)
  const [channelFormError, setChannelFormError] = useState('')
  const [channelsOpen, setChannelsOpen] = useState(false)
  const [threadRoot, setThreadRoot] = useState<ChatPost | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [memberListOpen, setMemberListOpen] = useState(false)
  const [wsMenuOpen, setWsMenuOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [pendingDeleteMsg, setPendingDeleteMsg] = useState<ChatPost | null>(null)
  const [channelInfoOpen, setChannelInfoOpen] = useState(false)
  const [profileUserId, setProfileUserId] = useState<string | null>(null)
  const [forwardMsg, setForwardMsg] = useState<ChatPost | null>(null)
  const [forwardTarget, setForwardTarget] = useState('')
  const [forwardBusy, setForwardBusy] = useState(false)
  const [newMessageOpen, setNewMessageOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false)
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set())
  const [draftIds, setDraftIds] = useState<Set<string>>(new Set())
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false)
  const [customStatusOpen, setCustomStatusOpen] = useState(false)
  const [channelNotifPrefsOpen, setChannelNotifPrefsOpen] = useState(false)
  const [pinnedPanelOpen, setPinnedPanelOpen] = useState(false)
  const [customStatusEmoji, setCustomStatusEmoji] = useState('')
  const [customStatusText, setCustomStatusText] = useState('')
  const [inviteModalOpen, setInviteModalOpen] = useState(false)
  const [inviteUrl, setInviteUrl] = useState('')
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteCopied, setInviteCopied] = useState(false)
  const [sidebarCustomizerOpen, setSidebarCustomizerOpen] = useState(false)
  const [showJumpBottom, setShowJumpBottom] = useState(false)
  const [unreadSepId, setUnreadSepId] = useState<string | null>(null)
  const [sidebarSections, setSidebarSections] = useState([
    { key: 'starred', label: 'Starred', icon: '⭐', enabled: true },
    { key: 'channels', label: 'Channels', icon: '#', enabled: true },
    { key: 'direct', label: 'Direct Messages', icon: '💬', enabled: true },
    { key: 'modules', label: 'Modules', icon: '📦', enabled: true },
    { key: 'people', label: 'People', icon: '👥', enabled: true }
  ])
  const sinceMsRef = useRef(0)
  const meRef = useRef<AppUser | null>(null)
  const userMapRef = useRef<Record<string, AppUser>>({})
  const timelineRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<ComposerHandle>(null)

  // ── Presence heartbeat & listener ───────────────────────────────────────
  usePresenceHeartbeat()
  useAutoAway()
  const { getStatus } = usePresenceListener(activeTeamId)
  const [channelBrowseOpen, setChannelBrowseOpen] = useState(false)
  const [emojiPanelOpen, setEmojiPanelOpen] = useState(false)
  const [leaveConfirmChannelId, setLeaveConfirmChannelId] = useState<string | null>(null)

  // ── Typing emitter for channel composer ─────────────────────────────────
  const { onDraftChange: emitTyping } = useTypingEmitter(channel?.id || '')

  // ── Sync refs ───────────────────────────────────────────────────────────
  useEffect(() => { meRef.current = me }, [me])
  useEffect(() => { userMapRef.current = userMap }, [userMap])

  // ── Read state tracking ─────────────────────────────────────────────────
  const latestCreateAt = useMemo(() => {
    if (posts.length === 0) return 0
    return posts[posts.length - 1]!.create_at
  }, [posts])
  useReadState(channel?.id || null, latestCreateAt)

  const bumpSinceFromPosts = useCallback((list: ChatPost[]) => {
    for (const p of list) {
      const t = Math.max(p.create_at || 0, p.edited_at || 0)
      if (t > sinceMsRef.current) sinceMsRef.current = t
    }
  }, [])

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = timelineRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }, [])

  // ── Show "jump to bottom" button when scrolled away ──────────────────
  useEffect(() => {
    const el = timelineRef.current
    if (!el) return
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      setShowJumpBottom(distFromBottom > 200)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [channel?.id])

  // ── Virtualized timeline ────────────────────────────────────────────────
  const { visibleRange, scrollToBottomIfPinned } = useVirtualTimeline(
    posts.length,
    timelineRef
  )
  const visiblePosts = useMemo(
    () => posts.slice(visibleRange.start, visibleRange.end),
    [posts, visibleRange.start, visibleRange.end]
  )

  // ── Load teams ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const r = await apiFetch('/api/workspaces', { method: 'GET' })
      if (r.status === 401) { router.replace('/login'); return }
      if (!r.ok) return
      const data = (await r.json()) as { teams?: Team[] }
      if (!cancelled) setTeams(data.teams ?? [])
    })()
    return () => { cancelled = true }
  }, [router])

  // ── Select active team ──────────────────────────────────────────────────
  useEffect(() => {
    if (teams.length === 0) return
    const fromUrl = searchParams.get('team') || ''
    const valid = teams.find(t => t.id === fromUrl)
    const next = valid?.id ?? teams[0].id
    setActiveTeamId(next)
    if (typeof window !== 'undefined') sessionStorage.setItem(TEAM_KEY, next)
    if (!valid) router.replace(`/home?team=${encodeURIComponent(next)}`)
  }, [teams, searchParams, router])

  // ── Load me ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const r = await apiFetch('/api/auth/me', { method: 'GET' })
      if (!r.ok) return
      const data = (await r.json()) as { user?: AppUser }
      if (!cancelled && data.user) {
        setMe(data.user)
        setUserMap(prev => ({ ...prev, [data.user!.id]: data.user! }))
      }
    })()
    return () => { cancelled = true }
  }, [])

  // ── Load workspace members ──────────────────────────────────────────────
  useEffect(() => {
    if (!activeTeamId) return
    let cancelled = false
    void (async () => {
      const r = await apiFetch(`/api/collab/workspace-members?workspace_id=${encodeURIComponent(activeTeamId)}`, { method: 'GET' })
      if (!r.ok) { if (!cancelled) setTeamMembers([]); return }
      const data = (await r.json()) as { users?: AppUser[] }
      if (!cancelled) setTeamMembers(data.users ?? [])
    })()
    return () => { cancelled = true }
  }, [activeTeamId])

  // ── Load channels ───────────────────────────────────────────────────────
  const loadChannels = useCallback(() => {
    if (!activeTeamId) return
    void (async () => {
      const r = await apiFetch(`/api/channels?workspace_id=${encodeURIComponent(activeTeamId)}`, { method: 'GET' })
      if (!r.ok) return
      const data = (await r.json()) as { channels?: Channel[] }
      const next = data.channels ?? []
      setChannels(next)
      setChannel(prev => {
        if (prev && next.some(c => c.id === prev.id)) return prev
        return next.find(c => c.name === 'all-aaelink') ?? next[0] ?? null
      })
    })()
  }, [activeTeamId])

  useEffect(() => { 
    loadChannels()
    const id = setInterval(loadChannels, 15000)
    return () => clearInterval(id)
  }, [loadChannels])

  // ── Deep-link navigation from desktop ───────────────────────────────────
  useEffect(() => {
    const unsub = window.aaelinkDesktop?.subscribeNavigateHome?.(payload => {
      const ws = String(payload?.workspace_id ?? '').trim()
      const fm = String(payload?.focus_message_id ?? '').trim()
      if (ws) {
        const q = new URLSearchParams({ team: ws })
        if (fm) q.set('focus_msg', fm)
        router.replace(`/home?${q.toString()}`)
      }
    })
    return () => { unsub?.() }
  }, [router])

  // ── aaelink:// deep link protocol handler ───────────────────────────────
  useEffect(() => {
    const unsub = window.aaelinkDesktop?.subscribeDeepLink?.(payload => {
      try {
        const url = new URL(payload?.url ?? '')
        // Expected: aaelink://workspace/<ws_id>/channel/<ch_name>
        const parts = url.pathname.replace(/^\/+/, '').split('/')
        const wsIdx = parts.indexOf('workspace')
        if (wsIdx >= 0 && parts[wsIdx + 1]) {
          const q = new URLSearchParams({ team: parts[wsIdx + 1] })
          const chIdx = parts.indexOf('channel')
          if (chIdx >= 0 && parts[chIdx + 1]) q.set('ch', parts[chIdx + 1])
          router.replace(`/home?${q.toString()}`)
        }
      } catch { /* malformed URL — ignore */ }
    })
    return () => { unsub?.() }
  }, [router])

  // ── Outbox flush on reconnect ───────────────────────────────────────────
  useEffect(() => {
    const unsub = startOutboxFlushListener(flushedIds => {
      // Remove pending ghosts for messages that were successfully sent
      if (flushedIds.length > 0) {
        const ids = new Set(flushedIds)
        setPosts(cur => cur.filter(p => !ids.has(p.id)))
      }
    })
    return unsub
  }, [])

  // ── Focus message scroll-into-view (from notification click / search) ──
  useEffect(() => {
    const focusId = searchParams.get('focus_msg')
    if (!focusId || posts.length === 0) return
    // Small delay so the timeline has rendered the target message
    const timer = setTimeout(() => {
      const el = timelineRef.current?.querySelector(`[data-message-id="${CSS.escape(focusId)}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('message--highlight')
        setTimeout(() => el.classList.remove('message--highlight'), 2400)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [searchParams, posts.length])

  // ── Resolve user profiles for posts ─────────────────────────────────────
  const resolveUsers = useCallback(async (list: ChatPost[]) => {
    const ids = [...new Set(list.map(p => p.user_id).filter(Boolean))]
    if (ids.length === 0) return
    const r = await apiFetch('/api/collab/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    })
    if (!r.ok) return
    const data = (await r.json()) as { users?: AppUser[] }
    const users = data.users ?? []
    setUserMap(prev => {
      const next = { ...prev }
      for (const u of users) next[u.id] = u
      return next
    })
  }, [])

  useEffect(() => { if (posts.length > 0) void resolveUsers(posts) }, [posts, resolveUsers])

  // ── Load messages + collab subscription ─────────────────────────────────
  useEffect(() => {
    if (!channel) return
    let cancelled = false
    sinceMsRef.current = 0
    setStreamUp(false)
    setOlderAvailable(false)
    setThreadRoot(null)
    setUnreadSepId(null)
    setShowJumpBottom(false)

    const chId = channel.id

    void (async () => {
      // 1) Instant hydrate from IndexedDB cache
      const cached = await readCachedPosts(chId, 60)
      if (!cancelled && cached.length > 0) {
        const asPosts: ChatPost[] = cached.map(c => ({ ...c, pending: false }))
        setPosts(asPosts)
        bumpSinceFromPosts(asPosts)
        scrollToBottom()
      }

      // 2) Server fetch (source of truth)
      const r = await apiFetch(`/api/messages?channel_id=${encodeURIComponent(chId)}`, { method: 'GET' })
      if (!r.ok || cancelled) return
      const data = (await r.json()) as { posts?: ChatPost[]; older_available?: boolean }
      const list = data.posts ?? []
      if (cancelled) return
      setPosts(list)
      bumpSinceFromPosts(list)
      setOlderAvailable(Boolean(data.older_available))
      scrollToBottom()

      // 3) Persist to IndexedDB for next instant load
      void cachePosts(list.filter(p => !p.pending))
      void setChannelMeta(chId, Date.now(), list.length)
      void pruneChannel(chId, 200)
    })()

    const ch = channel
    const wsId = activeTeamId

    const onIncoming = (incoming: ChatPost[]) => {
      if (cancelled || incoming.length === 0) return
      bumpSinceFromPosts(incoming)
      const selfId = meRef.current?.id
      const others = incoming.filter(p => p.user_id && p.user_id !== selfId && !p.root_id)
      if (others.length > 0 && selfId) {
        const last = others[others.length - 1]!
        const u = userMapRef.current[last.user_id]
        const author = u ? displayName(u) : last.user_id.slice(0, 8)
        notifyDesktopChatMessage({
          channelTitle: channelLabelForNotify(ch),
          authorLabel: author,
          message: last.message,
          extraCount: Math.max(0, others.length - 1),
          workspaceId: wsId,
          focusMessageId: last.id
        })
        if (!isDndActive()) playNotificationSound()
        // Set unread separator if the user is scrolled away
        const el = timelineRef.current
        if (el) {
          const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
          if (distFromBottom > 200) {
            setUnreadSepId(prev => prev || others[0]!.id)
          }
        }
      }
      // Only add root-level posts to the main timeline
      const rootPosts = incoming.filter(p => !p.root_id)
      if (rootPosts.length > 0) {
        setPosts(current => {
          const map = new Map(current.map(p => [p.id, p]))
          for (const p of rootPosts) map.set(p.id, { ...p, pending: false })
          return Array.from(map.values()).sort((a, b) => a.create_at - b.create_at)
        })
        scrollToBottomIfPinned()
        // Persist to IndexedDB
        void cachePosts(rootPosts.filter(p => !p.pending))
      }
      // Update reply_count on root posts for thread replies
      const threadReplies = incoming.filter(p => p.root_id)
      if (threadReplies.length > 0) {
        const rootIds = new Set(threadReplies.map(p => p.root_id!))
        setPosts(current =>
          current.map(p => rootIds.has(p.id) ? { ...p, reply_count: (p.reply_count || 0) + 1 } : p)
        )
      }
    }

    const onDeletions = (dels: CollabDeletion[]) => {
      if (cancelled || dels.length === 0) return
      const gone = new Set(dels.map(d => d.id))
      setPosts(cur => cur.filter(p => !gone.has(p.id)))
      // Remove from IndexedDB
      void removeCachedPosts(dels.map(d => d.id))
    }

    const stop = connectCollab(
      channel.id,
      () => sinceMsRef.current,
      onIncoming,
      undefined,
      onDeletions,
      up => { if (!cancelled) setStreamUp(up) }
    )

    return () => { cancelled = true; stop() }
  }, [channel, activeTeamId, bumpSinceFromPosts, scrollToBottom])

  // ── Message actions ─────────────────────────────────────────────────────
  const onReactionsUpdated = useCallback((messageId: string, reactions: ReactionSummary[]) => {
    setPosts(cur => cur.map(p => p.id === messageId ? { ...p, reactions } : p))
  }, [])

  const handleEditMessage = useCallback((post: ChatPost) => {
    setEditingId(post.id)
  }, [])

  const handleSaveEdit = useCallback(async (postId: string, newText: string) => {
    const post = posts.find(p => p.id === postId)
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
      setPosts(cur => cur.map(p => p.id === updated.id ? { ...updated, pending: false } : p))
    }
    setEditingId(null)
  }, [posts])

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
      setPosts(cur => cur.filter(p => !gone.has(p.id)))
    }
  }, [pendingDeleteMsg])

  // ── Pin message ─────────────────────────────────────────────────────────
  const handlePinMessage = useCallback(async (post: ChatPost) => {
    if (!channel) return
    await apiFetch('/api/pins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_id: channel.id, message_id: post.id })
    })
  }, [channel])

  // ── Forward message ─────────────────────────────────────────────────────
  const handleForwardMessage = useCallback((post: ChatPost) => {
    setForwardMsg(post)
    setForwardTarget('')
  }, [])

  const performForwardMsg = useCallback(async () => {
    if (!forwardMsg || !forwardTarget || forwardBusy) return
    setForwardBusy(true)
    const target = channels.find(c => c.name === forwardTarget || c.id === forwardTarget)
    if (target) {
      await apiFetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_id: target.id,
          message: `> _Forwarded message:_\n> ${forwardMsg.message}`
        })
      })
    }
    setForwardBusy(false)
    setForwardMsg(null)
  }, [forwardMsg, forwardTarget, forwardBusy, channels])

  // ── Send message ────────────────────────────────────────────────────────
  const handleSend = useCallback(async (message: string) => {
    if (!message.trim() || !channel || !me) return
    const pendingId = `pending-${crypto.randomUUID()}`
    const pending: ChatPost = {
      id: pendingId,
      channel_id: channel.id,
      user_id: me.id,
      message,
      create_at: Date.now(),
      pending: true
    }
    setPosts(current => [...current, pending])
    scrollToBottom()
    try {
      const res = await apiFetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: channel.id, message })
      })
      if (res.ok) {
        const saved = (await res.json()) as ChatPost
        bumpSinceFromPosts([saved])
        setPosts(current => {
          const without = current.filter(p => p.id !== pending.id)
          const map = new Map(without.map(p => [p.id, p]))
          map.set(saved.id, { ...saved, pending: false })
          return Array.from(map.values()).sort((a, b) => a.create_at - b.create_at)
        })
      } else {
        setPosts(current => current.filter(p => p.id !== pending.id))
      }
    } catch {
      // Network error — queue for retry on reconnect (pending ghost stays visible)
      void enqueueMessage({
        id: pendingId,
        channel_id: channel.id,
        message,
        queued_at: Date.now()
      })
    }
  }, [channel, me, bumpSinceFromPosts, scrollToBottom])

  // ── Load older messages ─────────────────────────────────────────────────
  async function loadOlder() {
    if (!channel || posts.length === 0 || olderLoading) return
    const oldest = posts[0]
    if (!oldest) return
    setOlderLoading(true)
    try {
      const q = new URLSearchParams({
        channel_id: channel.id,
        before_created_at: String(oldest.create_at),
        before_id: oldest.id
      })
      const r = await apiFetch(`/api/messages?${q}`, { method: 'GET' })
      if (!r.ok) return
      const data = (await r.json()) as { posts?: ChatPost[]; has_more?: boolean }
      setPosts(cur => [...(data.posts ?? []), ...cur])
      setOlderAvailable(Boolean(data.has_more))
    } finally {
      setOlderLoading(false)
    }
  }

  async function createChannel() {
    setChannelFormError('')
    const display_name = newChannelDisplay.trim()
    if (!display_name || !activeTeamId) { setChannelFormError('Enter a channel name.'); return }
    setChannelBusy(true)
    const res = await apiFetch('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        workspace_id: activeTeamId, 
        display_name, 
        name: newChannelSlug.trim() || undefined,
        purpose: newChannelPurpose.trim() || undefined,
        type: newChannelPrivate ? 'P' : 'O'
      })
    })
    setChannelBusy(false)
    if (!res.ok) { setChannelFormError('Could not create channel.'); return }
    const data = (await res.json()) as { channel?: Channel }
    setNewChannelOpen(false); setNewChannelDisplay(''); setNewChannelSlug(''); setNewChannelPurpose(''); setNewChannelPrivate(false)
    loadChannels()
    if (data?.channel?.id) setChannel(data.channel)
  }

  // ── Create DM or Group DM ───────────────────────────────────────────────
  const startChat = useCallback(async (peerIds: string[]) => {
    if (!activeTeamId || peerIds.length === 0) return
    const body: Record<string, any> = { workspace_id: activeTeamId, type: 'D' }
    if (peerIds.length === 1) {
      body.peer_user_id = peerIds[0]
    } else {
      body.peer_user_ids = peerIds
    }
    const res = await apiFetch('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!res.ok) return
    const data = (await res.json()) as { channel?: Channel }
    if (data?.channel) {
      loadChannels()
      setChannel(data.channel)
      setChannelsOpen(false)
    }
  }, [activeTeamId, loadChannels])

  const openDm = useCallback((peerId: string) => startChat([peerId]), [startChat])

  const channelTitle = channel?.type === 'D' ? (channel.dm_peer_display || channel.name) : (channel?.display_name || channel?.name || 'channel')
  const activeTeam = useMemo(() => teams.find(t => t.id === activeTeamId), [teams, activeTeamId])
  const dmPreview = useMemo(() => teamMembers.filter(u => u.id !== me?.id).slice(0, 8), [teamMembers, me])

  // ── Command palette items ─────────────────────────────────────────────
  const cmdItems: CommandPaletteItem[] = useMemo(() => {
    const list: CommandPaletteItem[] = []
    for (const ch of channels) {
      list.push({
        id: `ch-${ch.id}`,
        group: 'Channels',
        label: ch.type === 'D' ? (ch.dm_peer_display || ch.display_name || ch.name) : `# ${ch.display_name || ch.name}`,
        keywords: [ch.name],
        icon: ch.type === 'D' ? 'chat' : 'channel',
        run: () => { setChannel(ch); setChannelsOpen(false) }
      })
    }
    list.push(
      { id: 'nav-tickets', group: 'Modules', label: 'Tickets', icon: 'tickets', run: () => router.push('/tickets') },
      { id: 'nav-documents', group: 'Modules', label: 'Documents', icon: 'documents', run: () => router.push('/documents') },
      { id: 'nav-settings', group: 'Account', label: 'Settings', icon: 'settings', run: () => setSettingsDrawerOpen(true) },
      { id: 'nav-marketplace', group: 'Modules', label: 'Plugin Marketplace', icon: 'marketplace', run: () => router.push(`/home?team=${encodeURIComponent(activeTeamId)}&module=marketplace`) },
      { id: 'nav-workspaces', group: 'Account', label: 'All Workspaces', icon: 'workspaces', run: () => router.push('/workspaces') }
    )
    if (me && isPlatformAdmin(me.platform_role)) {
      list.push({ id: 'nav-admin', group: 'Account', label: 'Admin Panel', icon: 'admin', run: () => router.push('/admin') })
    }
    return list
  }, [channels, me, router])

  // ── Load starred channels from localStorage ─────────────────────────────
  useEffect(() => {
    setStarredIds(readStarredChannels())
    setDraftIds(new Set(getChannelIdsWithDrafts()))
  }, [])

  const handleToggleStar = useCallback((channelId: string) => {
    toggleStarChannel(channelId)
    setStarredIds(readStarredChannels())
  }, [])

  // Refresh draft indicators when channel changes
  useEffect(() => {
    setDraftIds(new Set(getChannelIdsWithDrafts()))
  }, [channel?.id])

  // ── ⌘/ / Ctrl+/: keyboard shortcuts modal ──────────────────────────────
  // ── ⌘⇧F / Ctrl+Shift+F: global search ────────────────────────────────
  // ── ⌘. / Ctrl+.: toggle right panel (channel info) ────────────────────
  // ── ⌘⇧L / Ctrl+Shift+L: toggle sidebar ───────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault()
        setShortcutsOpen(v => !v)
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        setGlobalSearchOpen(v => !v)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault()
        setChannelInfoOpen(v => !v)
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault()
        setChannelsOpen(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Desktop badge count sync ────────────────────────────────────────────
  useEffect(() => {
    const total = channels.reduce((s, c) => s + (c.unread_count ?? 0), 0)
    window.aaelinkDesktop?.setBadgeCount?.(total)?.catch(() => {})
  }, [channels])

  // ── Responsive channel panel ────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(max-width: 920px)')
    const sync = () => { if (!mq.matches) setChannelsOpen(false) }
    sync(); mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (!channelsOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setChannelsOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [channelsOpen])

  // ── Escape: close workspace/user menus ────────────────────────────────
  useEffect(() => {
    if (!wsMenuOpen && !userMenuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setWsMenuOpen(false); setUserMenuOpen(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [wsMenuOpen, userMenuOpen])

  // ── Cmd+K Quick Switcher ───────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setQuickSwitcherOpen(o => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <main className={`app-shell${channelsOpen ? ' app-shell--channels-open' : ''}${threadRoot ? ' app-shell--thread-open' : ''}`}>
      {/* ── Workspace rail ──────────────────────────────────────── */}
      <aside className="workspace-rail" aria-label="Workspaces">
        {teams.map(t => (
          <Link key={t.id} href={`/home?team=${encodeURIComponent(t.id)}`}
            className={`workspace-icon${t.id === activeTeamId ? ' active' : ''}`}
            title={t.display_name}
            onClick={() => sessionStorage.setItem(TEAM_KEY, t.id)}>
            {(t.display_name || t.name).slice(0, 1).toUpperCase()}
          </Link>
        ))}
        <div className="rail-dot" />
        <Link className="workspace-icon small" href="/workspaces" title="All workspaces">+</Link>
      </aside>

      {/* ── Channel sidebar ─────────────────────────────────────── */}
      <aside id="app-shell-channel-list" className="channel-list" aria-label="Channels and modules">
        {/* ── Workspace header dropdown (Slack/Mattermost style) ── */}
        <header className="team-header" style={{ position: 'relative' }}>
          <button type="button" className="ws-header-btn" onClick={() => setWsMenuOpen(o => !o)}
            aria-haspopup="true" aria-expanded={wsMenuOpen}>
            <strong>{activeTeam?.display_name || 'Workspace'}</strong>
            <ChevronDown size={16} className={`ws-header-chevron${wsMenuOpen ? ' ws-header-chevron--open' : ''}`} />
          </button>
          <div style={{ flex: 1 }} />
          <button type="button" className="mm-icon-btn" title="New message" onClick={() => setNewChannelOpen(true)}
            style={{ color: 'rgba(255,255,255,0.6)' }}>
            <Plus size={18} />
          </button>

          {/* ── Workspace dropdown menu ────────────────────────── */}
          {wsMenuOpen && (
            <>
              <div className="ws-menu-backdrop" onClick={() => setWsMenuOpen(false)} />
              <div className="ws-dropdown" role="menu" aria-label="Workspace options">
                <div className="ws-dropdown-header">
                  <div className="ws-dropdown-avatar">{(activeTeam?.display_name || 'W').slice(0, 1).toUpperCase()}</div>
                  <div>
                    <strong className="ws-dropdown-name">{activeTeam?.display_name || 'Workspace'}</strong>
                    <span className="ws-dropdown-url">{activeTeam?.name || ''}.aaelink.app</span>
                  </div>
                </div>
                <div className="ws-dropdown-divider" />
                <button type="button" className="ws-dropdown-item" onClick={async () => {
                  setWsMenuOpen(false)
                  setInviteBusy(true)
                  setInviteUrl('')
                  setInviteCopied(false)
                  setInviteModalOpen(true)
                  try {
                    const res = await apiFetch('/api/workspaces/invite', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ workspace_id: activeTeamId })
                    })
                    if (res.ok) {
                      const data = await res.json() as { invite_url: string }
                      setInviteUrl(`${window.location.origin}${data.invite_url}`)
                    }
                  } catch { /* ignore */ }
                  setInviteBusy(false)
                }}>
                  <UserPlus size={16} /> Invite people to {activeTeam?.display_name || 'workspace'}
                </button>
                <button type="button" className="ws-dropdown-item" onClick={() => { setWsMenuOpen(false); setSettingsDrawerOpen(true) }}>
                  <Settings size={16} /> Preferences
                </button>
                <button type="button" className="ws-dropdown-item" onClick={() => { setWsMenuOpen(false); setSidebarCustomizerOpen(true) }}>
                  <Paintbrush size={16} /> Customize sidebar
                </button>
                <button type="button" className="ws-dropdown-item" onClick={() => { setWsMenuOpen(false); setShortcutsOpen(true) }}>
                  <Keyboard size={16} /> Keyboard shortcuts
                </button>
                <button type="button" className="ws-dropdown-item" onClick={() => { setWsMenuOpen(false); setEmojiPanelOpen(true) }}>
                  <SmilePlus size={16} /> Custom emoji
                </button>
                <div className="ws-dropdown-divider" />
                <Link href="/workspaces" className="ws-dropdown-item" onClick={() => setWsMenuOpen(false)}>
                  <Plus size={16} /> Create or join a workspace
                </Link>
                {me && isPlatformAdmin(me.platform_role) ? (
                  <Link href="/admin" className="ws-dropdown-item" onClick={() => setWsMenuOpen(false)}>
                    <ShieldAlert size={16} /> Administration
                  </Link>
                ) : null}
                <div className="ws-dropdown-divider" />
                <button type="button" className="ws-dropdown-item ws-dropdown-item--danger"
                  onClick={async () => { setWsMenuOpen(false); await apiFetch('/api/auth/logout', { method: 'POST' }); router.replace('/login') }}>
                  <LogOut size={16} /> Sign out of {activeTeam?.display_name || 'workspace'}
                </button>
              </div>
            </>
          )}
        </header>

        <div className="sidebar-search">
          <div className="sidebar-search-wrap">
            <Search size={14} className="sidebar-search-icon" />
            <input
              type="text"
              className="sidebar-search-input"
              placeholder="Find channels... ⌘K"
              readOnly
              onClick={() => setCmdPaletteOpen(true)}
            />
          </div>
        </div>

        <div className="sidebar-scrollable">
          <section className="channel-section top-nav-section">
            <button className={`channel${activeModule === 'threads' ? ' active' : ''}`} onClick={() => { setChannelsOpen(false); router.push(`/home?team=${encodeURIComponent(activeTeamId)}&module=threads`) }}><MessageSquare size={16} className="channel-icon" /> Threads</button>
            <button className={`channel${activeModule === 'saved' ? ' active' : ''}`} onClick={() => { setChannelsOpen(false); router.push(`/home?team=${encodeURIComponent(activeTeamId)}&module=saved`) }}><Bookmark size={16} className="channel-icon" /> Saved items</button>
          </section>

          {/* ── Starred Channels ──────────────────────────────────── */}
          {channels.filter(c => starredIds.has(c.id)).length > 0 && (
            <SidebarSection id="starred" title="Starred">
              {channels.filter(c => starredIds.has(c.id)).map(item => (
                <button type="button"
                  className={`channel${channel?.id === item.id && !activeModule ? ' active' : ''}${(item.unread_count ?? 0) > 0 ? ' channel--unread' : ''}`}
                  key={`star-${item.id}`}
                  onClick={() => { setChannel(item); setChannelsOpen(false); router.push(`/home?team=${encodeURIComponent(activeTeamId)}`) }}>
                  <Star size={14} className="channel-icon" style={{ color: '#f5ab00', fill: '#f5ab00' }} />
                  <span className="channel-name">{item.display_name || item.name}</span>
                  {(item.unread_count ?? 0) > 0 ? (
                    <span className="channel-unread">{item.unread_count}</span>
                  ) : null}
                </button>
              ))}
            </SidebarSection>
          )}

          <SidebarSection id="channels" title="Channels" onAdd={() => setNewChannelOpen(true)}>
            {channels.filter(c => c.type !== 'D').map(item => (
              <button type="button"
                className={`channel${channel?.id === item.id && !activeModule ? ' active' : ''}${(item.unread_count ?? 0) > 0 ? ' channel--unread' : ''}`}
                key={item.id}
                title={item.purpose ? `${item.display_name || item.name}\n${item.purpose}` : (item.display_name || item.name)}
                onContextMenu={(e) => { e.preventDefault(); handleToggleStar(item.id) }}
                onClick={() => { setChannel(item); setChannelsOpen(false); router.push(`/home?team=${encodeURIComponent(activeTeamId)}`) }}>
                {starredIds.has(item.id)
                  ? <Star size={14} className="channel-icon" style={{ color: '#f5ab00', fill: '#f5ab00' }} />
                  : item.type === 'P' ? <Lock size={15} className="channel-icon" /> : <Hash size={15} className="channel-icon" />}
                <span className="channel-name">{item.display_name || item.name}</span>
                {(item.unread_count ?? 0) > 0 ? (
                  <span className="channel-unread">{item.unread_count}</span>
                ) : draftIds.has(item.id) ? (
                  <PenLine size={12} className="channel-draft-icon" />
                ) : null}
              </button>
            ))}
          </SidebarSection>

          {/* Browse channels link */}
          <button
            type="button"
            className="channel channel--browse"
            onClick={() => setChannelBrowseOpen(true)}
            style={{ fontSize: 12, color: 'var(--mm-sidebar-text)', opacity: 0.8, paddingLeft: 20, gap: 6 }}
          >
            <Search size={13} className="channel-icon" />
            <span className="channel-name">Browse channels</span>
          </button>

          <SidebarSection id="dms" title="Direct messages" onAdd={() => setNewMessageOpen(true)}>
            {channels.filter(c => c.type === 'D' || c.type === 'G').map(item => {
              if (item.type === 'G') {
                return (
                  <button type="button"
                    className={`channel${channel?.id === item.id && !activeModule ? ' active' : ''}${(item.unread_count ?? 0) > 0 ? ' channel--unread' : ''}`}
                    key={item.id}
                    onClick={() => { setChannel(item); setChannelsOpen(false); router.push(`/home?team=${encodeURIComponent(activeTeamId)}`) }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '16px', height: '16px', background: 'var(--c-bg-tertiary)', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold' }}>
                      {item.display_name.split(',').length + 1}
                    </div>
                    <span className="channel-name" style={{ marginLeft: '6px' }}>{item.display_name}</span>
                    {(item.unread_count ?? 0) > 0 ? (
                      <span className="channel-unread">{item.unread_count}</span>
                    ) : null}
                  </button>
                )
              }
              const peerId = item.name.split('__').find(id => id !== me?.id) || ''
              const status = getStatus(peerId)
              return (
                <button type="button"
                  className={`channel${channel?.id === item.id && !activeModule ? ' active' : ''}${(item.unread_count ?? 0) > 0 ? ' channel--unread' : ''}`}
                  key={item.id}
                  onClick={() => { setChannel(item); setChannelsOpen(false); router.push(`/home?team=${encodeURIComponent(activeTeamId)}`) }}>
                  <span className={`presence presence--${status}`} aria-hidden="true" />
                  <span className="channel-name">{item.dm_peer_display || item.display_name || item.name}</span>
                  {(item.unread_count ?? 0) > 0 ? (
                    <span className="channel-unread">{item.unread_count}</span>
                  ) : null}
                </button>
              )
            })}
          </SidebarSection>

          <SidebarSection id="modules" title="Modules">
            <button className={`channel${activeModule === 'tickets' ? ' active' : ''}`} onClick={() => { setChannelsOpen(false); router.push(`/home?team=${encodeURIComponent(activeTeamId)}&module=tickets`) }}><AlignLeft size={15} className="channel-icon"/> <span className="channel-name">Tickets</span></button>
            <button className={`channel${activeModule === 'documents' ? ' active' : ''}`} onClick={() => { setChannelsOpen(false); router.push(`/home?team=${encodeURIComponent(activeTeamId)}&module=documents`) }}><FileText size={15} className="channel-icon"/> <span className="channel-name">Documents</span></button>
            <button className={`channel${activeModule === 'approvals' ? ' active' : ''}`} onClick={() => { setChannelsOpen(false); router.push(`/home?team=${encodeURIComponent(activeTeamId)}&module=approvals`) }}><CheckSquare size={15} className="channel-icon"/> <span className="channel-name">Approvals</span></button>
            <button className={`channel${activeModule === 'knowledge' ? ' active' : ''}`} onClick={() => { setChannelsOpen(false); router.push(`/home?team=${encodeURIComponent(activeTeamId)}&module=knowledge`) }}><Book size={15} className="channel-icon"/> <span className="channel-name">Knowledge Base</span></button>
            <button className={`channel${activeModule === 'calendar' ? ' active' : ''}`} onClick={() => { setChannelsOpen(false); router.push(`/home?team=${encodeURIComponent(activeTeamId)}&module=calendar`) }}><Calendar size={15} className="channel-icon"/> <span className="channel-name">HR & Calendar</span></button>
            {me && isPlatformAdmin(me.platform_role) && <button className={`channel${activeModule === 'integrations' ? ' active' : ''}`} onClick={() => { setChannelsOpen(false); router.push(`/home?team=${encodeURIComponent(activeTeamId)}&module=integrations`) }}><Puzzle size={15} className="channel-icon"/> <span className="channel-name">Integrations</span></button>}
            {me && isPlatformAdmin(me.platform_role) && <button className={`channel${activeModule === 'sso' ? ' active' : ''}`} onClick={() => { setChannelsOpen(false); router.push(`/home?team=${encodeURIComponent(activeTeamId)}&module=sso`) }}><ShieldAlert size={15} className="channel-icon"/> <span className="channel-name">SSO Settings</span></button>}
            <button className={`channel${activeModule === 'marketplace' ? ' active' : ''}`} onClick={() => { setChannelsOpen(false); router.push(`/home?team=${encodeURIComponent(activeTeamId)}&module=marketplace`) }}><Package size={15} className="channel-icon"/> <span className="channel-name">Marketplace</span></button>
          </SidebarSection>

          <SidebarSection id="people" title="People">
            {dmPreview.length === 0 ? (
              <p className="channel-empty">No other members in this workspace yet.</p>
            ) : (
              dmPreview.map(u => {
                const status = getStatus(u.id)
                return (
                  <button type="button" className="channel dm dm-clickable" key={u.id}
                    onClick={() => void openDm(u.id)}>
                    <span className={`presence presence--${status}`} aria-hidden="true" />
                    <span className="channel-name">{displayName(u)}</span>
                  </button>
                )
              })
            )}
          </SidebarSection>
        </div>

        {/* ── User profile footer (Slack-style) ────────────────── */}
        <footer className="sidebar-user-footer" style={{ position: 'relative' }}>
          <button type="button" className="sidebar-user-btn" onClick={() => setUserMenuOpen(o => !o)}
            aria-haspopup="true" aria-expanded={userMenuOpen}>
            <div className="sidebar-user-avatar">
              {(me?.username || me?.first_name || 'U').slice(0, 1).toUpperCase()}
              <span className={`sidebar-user-presence presence--${getStatus(me?.id || '')}`} />
            </div>
            <div className="sidebar-user-info">
              <strong>{me ? displayName(me) : 'Loading...'}</strong>
              <span className="sidebar-user-status">
                {getStatus(me?.id || '') === 'dnd'
                  ? <><BellOff size={10} /> Do Not Disturb</>
                  : <><CircleDot size={10} /> Active</>}
              </span>
            </div>
            <ChevronUp size={16} className="sidebar-user-chevron" />
          </button>

          {/* ── User popover menu ──────────────────────────────── */}
          {userMenuOpen && (
            <>
              <div className="ws-menu-backdrop" onClick={() => setUserMenuOpen(false)} />
              <div className="user-dropdown" role="menu" aria-label="User menu">
                <div className="ws-dropdown-header">
                  <div className="ws-dropdown-avatar">{(me?.username || 'U').slice(0, 1).toUpperCase()}</div>
                  <div>
                    <strong className="ws-dropdown-name">{me ? displayName(me) : 'User'}</strong>
                    <span className="ws-dropdown-url">@{me?.username || ''}</span>
                  </div>
                </div>
                <div className="ws-dropdown-divider" />
                <button type="button" className="ws-dropdown-item" onClick={() => { setUserMenuOpen(false); setSettingsDrawerOpen(true) }}>
                  <Settings size={16} /> Profile &amp; preferences
                </button>
                <button type="button" className="ws-dropdown-item" onClick={() => { setUserMenuOpen(false); setCustomStatusOpen(true) }}>
                  <SmilePlus size={16} /> Set a custom status
                </button>
                {me && isPlatformAdmin(me.platform_role) ? (
                  <Link href="/admin" className="ws-dropdown-item" onClick={() => setUserMenuOpen(false)}>
                    <ShieldAlert size={16} /> Administration
                  </Link>
                ) : null}
                <div className="ws-dropdown-divider" />
                <div className="ws-dropdown-status-section" style={{ padding: '6px 12px' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--mm-muted)', letterSpacing: '0.5px' }}>Set status</span>
                  <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                    {([
                      { key: 'online', label: 'Online', color: 'var(--mm-online)' },
                      { key: 'away', label: 'Away', color: 'var(--mm-away)' },
                      { key: 'dnd', label: 'DND', color: '#d24b4e' },
                      { key: 'offline', label: 'Offline', color: 'var(--mm-offline)' }
                    ] as const).map(s => (
                      <button key={s.key} type="button"
                        style={{
                          flex: 1, padding: '5px 0', border: '1px solid var(--mm-border-subtle)',
                          borderRadius: 6, background: 'transparent', cursor: 'pointer',
                          fontSize: 11, fontWeight: 500, color: 'var(--fg)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                          transition: 'background 0.15s'
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(128,128,128,0.1)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                        onClick={async () => {
                          await apiFetch('/api/user-status', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ status: s.key })
                          })
                          setUserMenuOpen(false)
                        }}
                      >
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="ws-dropdown-divider" />
                <button type="button" className="ws-dropdown-item ws-dropdown-item--danger"
                  onClick={async () => { setUserMenuOpen(false); await apiFetch('/api/auth/logout', { method: 'POST' }); router.replace('/login') }}>
                  <LogOut size={16} /> Sign out
                </button>
              </div>
            </>
          )}
        </footer>
      </aside>

      {/* ── Main pane ───────────────────────────────────────────── */}
      {activeModule === 'tickets' ? (
        <section className="chat-pane" style={{ background: 'var(--mm-main-bg)' }}>
          <header className="chat-header">
            <div className="chat-header-nav">
              <button type="button" className="app-shell-menu-btn"
                aria-expanded={channelsOpen} aria-controls="app-shell-channel-list"
                aria-label={channelsOpen ? 'Close channels list' : 'Open channels list'}
                onClick={() => setChannelsOpen(o => !o)}>
                <Menu size={20} strokeWidth={2} aria-hidden />
              </button>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1>Tickets</h1>
              <p>Manage and track support requests</p>
            </div>
            <div className="chat-header-nav">
              <NotificationsBell enabled={Boolean(me)} />
            </div>
          </header>
          <div style={{ flex: 1, position: 'relative' }}>
            <TicketsPanel workspaceId={activeTeamId} onBlockingOverlayChange={() => {}} />
          </div>
        </section>
      ) : activeModule === 'documents' ? (
        <section className="chat-pane" style={{ background: 'var(--mm-main-bg)' }}>
          <header className="chat-header">
            <div className="chat-header-nav">
              <button type="button" className="app-shell-menu-btn"
                aria-expanded={channelsOpen} aria-controls="app-shell-channel-list"
                aria-label={channelsOpen ? 'Close channels list' : 'Open channels list'}
                onClick={() => setChannelsOpen(o => !o)}>
                <Menu size={20} strokeWidth={2} aria-hidden />
              </button>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1>Documents</h1>
              <p>Shared files and policies</p>
            </div>
            <div className="chat-header-nav">
              <NotificationsBell enabled={Boolean(me)} />
            </div>
          </header>
          <div style={{ flex: 1, position: 'relative' }}>
            <DocumentsPanel workspaceId={activeTeamId} />
          </div>
        </section>
      ) : activeModule === 'approvals' ? (
        <section className="chat-pane" style={{ background: 'var(--mm-main-bg)' }}>
          <header className="chat-header">
            <div className="chat-header-nav">
              <button type="button" className="app-shell-menu-btn"
                aria-expanded={channelsOpen} aria-controls="app-shell-channel-list"
                aria-label={channelsOpen ? 'Close channels list' : 'Open channels list'}
                onClick={() => setChannelsOpen(o => !o)}>
                <Menu size={20} strokeWidth={2} aria-hidden />
              </button>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1>Approvals</h1>
              <p>Manage pending workflows and requests</p>
            </div>
            <div className="chat-header-nav">
              <NotificationsBell enabled={Boolean(me)} />
            </div>
          </header>
          <div style={{ flex: 1, position: 'relative' }}>
            <ApprovalsPanel workspaceId={activeTeamId} />
          </div>
        </section>
      ) : activeModule === 'knowledge' ? (
        <section className="chat-pane" style={{ background: 'var(--mm-main-bg)' }}>
          <header className="chat-header">
            <div className="chat-header-nav">
              <button type="button" className="app-shell-menu-btn"
                aria-expanded={channelsOpen} aria-controls="app-shell-channel-list"
                aria-label={channelsOpen ? 'Close channels list' : 'Open channels list'}
                onClick={() => setChannelsOpen(o => !o)}>
                <Menu size={20} strokeWidth={2} aria-hidden />
              </button>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1>Knowledge Base</h1>
              <p>Company wiki and documentation</p>
            </div>
            <div className="chat-header-nav">
              <NotificationsBell enabled={Boolean(me)} />
            </div>
          </header>
          <div style={{ flex: 1, position: 'relative' }}>
            <KnowledgeBasePanel workspaceId={activeTeamId} />
          </div>
        </section>
      ) : activeModule === 'calendar' ? (
        <section className="chat-pane" style={{ background: 'var(--mm-main-bg)' }}>
          <header className="chat-header">
            <div className="chat-header-nav">
              <button type="button" className="app-shell-menu-btn"
                aria-expanded={channelsOpen} aria-controls="app-shell-channel-list"
                aria-label={channelsOpen ? 'Close channels list' : 'Open channels list'}
                onClick={() => setChannelsOpen(o => !o)}>
                <Menu size={20} strokeWidth={2} aria-hidden />
              </button>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1>HR & Calendar</h1>
              <p>Schedule events, manage leaves, and track attendance</p>
            </div>
            <div className="chat-header-nav">
              <NotificationsBell enabled={Boolean(me)} />
            </div>
          </header>
          <div style={{ flex: 1, position: 'relative' }}>
            <CalendarPanel workspaceId={activeTeamId} />
          </div>
        </section>
      ) : activeModule === 'integrations' && me && isPlatformAdmin(me.platform_role) ? (
        <section className="chat-pane" style={{ background: 'var(--mm-main-bg)' }}>
          <header className="chat-header">
            <div className="chat-header-nav">
              <button type="button" className="app-shell-menu-btn"
                aria-expanded={channelsOpen} aria-controls="app-shell-channel-list"
                aria-label={channelsOpen ? 'Close channels list' : 'Open channels list'}
                onClick={() => setChannelsOpen(o => !o)}>
                <Menu size={20} strokeWidth={2} aria-hidden />
              </button>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1>Integrations</h1>
              <p>Connect external tools, webhooks, and apps</p>
            </div>
            <div className="chat-header-nav">
              <NotificationsBell enabled={Boolean(me)} />
            </div>
          </header>
          <div style={{ flex: 1, position: 'relative' }}>
            <IntegrationsPanel workspaceId={activeTeamId} />
          </div>
        </section>
      ) : activeModule === 'sso' && me && isPlatformAdmin(me.platform_role) ? (
        <section className="chat-pane" style={{ background: 'var(--mm-main-bg)' }}>
          <header className="chat-header">
            <div className="chat-header-nav">
              <button type="button" className="app-shell-menu-btn"
                aria-expanded={channelsOpen} aria-controls="app-shell-channel-list"
                aria-label={channelsOpen ? 'Close channels list' : 'Open channels list'}
                onClick={() => setChannelsOpen(o => !o)}>
                <Menu size={20} strokeWidth={2} aria-hidden />
              </button>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1>SSO Settings</h1>
              <p>Configure Single Sign-On and Identity Providers</p>
            </div>
            <div className="chat-header-nav">
              <NotificationsBell enabled={Boolean(me)} />
            </div>
          </header>
          <div style={{ flex: 1, position: 'relative', overflowY: 'auto' }}>
            <SsoSettingsPanel />
          </div>
        </section>
      ) : activeModule === 'marketplace' ? (
        <section className="chat-pane" style={{ background: 'var(--mm-main-bg)' }}>
          <header className="chat-header">
            <div className="chat-header-nav">
              <button type="button" className="app-shell-menu-btn"
                aria-expanded={channelsOpen} aria-controls="app-shell-channel-list"
                aria-label={channelsOpen ? 'Close channels list' : 'Open channels list'}
                onClick={() => setChannelsOpen(o => !o)}>
                <Menu size={20} strokeWidth={2} aria-hidden />
              </button>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1>Plugin Marketplace</h1>
              <p>Browse, install, and publish workspace plugins</p>
            </div>
            <div className="chat-header-nav">
              <NotificationsBell enabled={Boolean(me)} />
            </div>
          </header>
          <div style={{ flex: 1, position: 'relative', overflowY: 'auto' }}>
            <MarketplacePanel workspaceId={activeTeamId} />
          </div>
        </section>
      ) : activeModule === 'threads' ? (
        <section className="chat-pane" style={{ background: 'var(--mm-main-bg)' }}>
          <header className="chat-header">
            <div className="chat-header-nav">
              <button type="button" className="app-shell-menu-btn"
                onClick={() => setChannelsOpen(o => !o)}>
                <Menu size={20} strokeWidth={2} aria-hidden />
              </button>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1>Threads</h1>
              <p>Keep track of conversations</p>
            </div>
            <div className="chat-header-nav">
              <NotificationsBell enabled={Boolean(me)} />
            </div>
          </header>
          <ThreadsListPanel workspaceId={activeTeamId} onOpenThread={(chId, rootId) => {
            // Navigate to the channel and open the thread
            const ch = channels.find(c => c.id === chId)
            if (ch) {
              router.push(`/home?team=${encodeURIComponent(activeTeamId)}&channel=${encodeURIComponent(ch.name)}&thread=${encodeURIComponent(rootId)}`)
            }
          }} />
        </section>
      ) : activeModule === 'saved' ? (
        <section className="chat-pane" style={{ background: 'var(--mm-main-bg)' }}>
          <header className="chat-header">
            <div className="chat-header-nav">
              <button type="button" className="app-shell-menu-btn"
                onClick={() => setChannelsOpen(o => !o)}>
                <Menu size={20} strokeWidth={2} aria-hidden />
              </button>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1>Saved items</h1>
              <p>Your saved messages and files</p>
            </div>
            <div className="chat-header-nav">
              <NotificationsBell enabled={Boolean(me)} />
            </div>
          </header>
          <SavedItemsPanel onOpenMessage={(chId, msgId) => {
            const ch = channels.find(c => c.id === chId)
            if (ch) {
              const qs = `team=${encodeURIComponent(activeTeamId)}&channel=${encodeURIComponent(ch.name)}${msgId ? `&focus_msg=${encodeURIComponent(msgId)}` : ''}`
              router.push(`/home?${qs}`)
            }
          }} />
        </section>
      ) : (
        <>
        <section className="chat-pane">
        <UpdateBanner />
        <header className="chat-header">
          <div className="chat-header-nav">
            <button type="button" className="app-shell-menu-btn"
              aria-expanded={channelsOpen} aria-controls="app-shell-channel-list"
              aria-label={channelsOpen ? 'Close channels list' : 'Open channels list'}
              onClick={() => setChannelsOpen(o => !o)}>
              <Menu size={20} strokeWidth={2} aria-hidden />
            </button>
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
              {channel?.type === 'P' ? <Lock size={22} style={{marginRight: 8, color: 'var(--mm-muted)'}} /> : channel?.type === 'D' ? null : <Hash size={22} style={{marginRight: 8, color: 'var(--mm-muted)'}} />}
              <h1 style={{ margin: 0, fontSize: 18 }}>{channelTitle}</h1>
              {channel && channel.type !== 'D' && (
                <ChannelHeaderDropdown
                  channelId={channel.id}
                  channelName={channel.display_name || channel.name}
                  channelType={channel.type || 'O'}
                  isStarred={starredIds.has(channel.id)}
                  onToggleStar={() => handleToggleStar(channel.id)}
                  onLeaveChannel={() => {
                    setLeaveConfirmChannelId(channel.id)
                  }}
                  onInviteToChannel={() => setInviteModalOpen(true)}
                />
              )}
            </div>
            {channel && channel.type !== 'D' && (
              <ChannelTopicInline
                channelId={channel.id}
                topic={channel.purpose || ''}
                onSaved={(newTopic) => {
                  setChannels(prev => prev.map(c => c.id === channel.id ? { ...c, purpose: newTopic } : c))
                }}
              />
            )}
          </div>
          <div className="chat-header-nav">
            <button type="button" className="mm-icon-btn" title="Search messages"
              aria-label="Search messages" onClick={() => setSearchOpen(true)}>
              <Search size={18} aria-hidden />
            </button>
            <button type="button" className={`mm-icon-btn${channelInfoOpen ? ' mm-icon-btn--active' : ''}`} title="Channel details"
              aria-label="Channel details" aria-pressed={channelInfoOpen}
              onClick={() => setChannelInfoOpen(o => !o)}>
              <Info size={18} aria-hidden />
            </button>
            <button type="button" className={`mm-icon-btn${pinnedPanelOpen ? ' mm-icon-btn--active' : ''}`} title="Pinned messages"
              aria-label="Pinned messages" aria-pressed={pinnedPanelOpen}
              onClick={() => setPinnedPanelOpen(o => !o)}>
              <Pin size={16} aria-hidden />
            </button>
            <NotificationsBell enabled={Boolean(me)} />
            {channel && channel.type !== 'D' && (
              <button type="button" className="mm-icon-btn" title="Notification preferences"
                aria-label="Notification preferences"
                onClick={() => setChannelNotifPrefsOpen(true)}>
                <BellOff size={16} aria-hidden />
              </button>
            )}
            <button type="button" className={`mm-icon-btn${memberListOpen ? ' mm-icon-btn--active' : ''}`} title="Members"
              aria-label="Channel members" aria-pressed={memberListOpen}
              onClick={() => setMemberListOpen(o => !o)}
              style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 13, fontWeight: 600 }}>
              <Users size={16} aria-hidden />
              <span style={{ opacity: 0.7 }}>{teamMembers.length || ''}</span>
            </button>
            <span className={`status-pill${streamUp ? ' online' : ''}`}>
              {streamUp ? 'Live' : 'Connecting'}
            </span>
          </div>
        </header>

        {/* ── Bookmark bar (Slack-style channel bookmarks) ──── */}
        {channel && <BookmarkBar channelId={channel.id} channelType={channel.type} />}

        <div className="message-timeline" ref={timelineRef}>
          {olderAvailable ? (
            <div style={{ padding: '8px 0', textAlign: 'center' }}>
              <button type="button" className="ghost-button" disabled={olderLoading}
                onClick={() => void loadOlder()}>
                {olderLoading ? 'Loading…' : 'Load older messages'}
              </button>
            </div>
          ) : null}

          {posts.length === 0 && (
            <div className="channel-intro-block" style={{ padding: '40px 20px', marginTop: 'auto' }}>
              <div style={{ width: '72px', height: '72px', background: 'var(--mm-sidebar-bg)', color: 'white', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', marginBottom: '20px' }}>
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
            </div>
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
                  <div className="date-divider">
                    <span className="date-divider-text">
                      {new Date(post.create_at).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                    </span>
                  </div>
                )}
                {editingId === post.id ? (
                  <div className={`message message--editing${isCompact && !showDateDivider ? ' message--compact' : ''}`}>
                    <Composer
                      channelId={channel?.id || ''}
                      channelTitle={channel?.display_name || channel?.name || ''}
                      channelType={channel?.type}
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
                    compact={isCompact && !showDateDivider}
                    onOpenThread={setThreadRoot}
                    onEditMessage={handleEditMessage}
                    onDeleteMessage={handleDeleteMessage}
                    onForwardMessage={handleForwardMessage}
                    onPinMessage={handlePinMessage}
                    onAvatarClick={uid => setProfileUserId(uid)}
                    onMentionClick={username => {
                      // Resolve @username to userId and open profile card
                      const found = Object.values(userMap).find(u => u.username === username)
                      if (found) setProfileUserId(found.id)
                    }}
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

        {/* ── Jump to bottom floating button ────────────────────── */}
        {showJumpBottom && (
          <button
            type="button"
            className="jump-to-bottom-btn"
            onClick={() => { scrollToBottom(); setShowJumpBottom(false) }}
            aria-label="Jump to latest messages"
          >
            ↓ Jump to latest
          </button>
        )}

        <Composer ref={composerRef} channelId={channel?.id || ''} channelTitle={channelTitle}
          channelType={channel?.type} me={me as SlashMeUser | null}
          workspaceId={activeTeamId}
          teamMembers={teamMembers} onSend={msg => void handleSend(msg)}
          onDraftChange={emitTyping} />
      </section>

      {/* ── Member list panel (right sidebar) ─────────────────── */}
      {memberListOpen && (
        <aside className="member-list-panel">
          <header className="member-list-header">
            <h2>Members</h2>
            <button type="button" className="mm-icon-btn" onClick={() => setMemberListOpen(false)} aria-label="Close member list">
              <span aria-hidden>✕</span>
            </button>
          </header>
          <div className="member-list-body">
            {teamMembers.length === 0 ? (
              <p className="member-list-empty">No members to display.</p>
            ) : (
              teamMembers.map(u => {
                const status = getStatus(u.id)
                const name = displayName(u)
                return (
                  <button key={u.id} type="button" className="member-list-item" onClick={() => { void openDm(u.id); setMemberListOpen(false) }}>
                    <div className="member-list-avatar">
                      {(u.username || name).slice(0, 1).toUpperCase()}
                      <span className={`member-list-presence presence--${status}`} />
                    </div>
                    <div className="member-list-info">
                      <strong>{name}</strong>
                      <span>@{u.username}</span>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </aside>
      )}

      {/* ── Channel Info panel (right sidebar) ─────────────────── */}
      {channelInfoOpen && channel && me && (
        <ChannelInfoPanel channelId={channel.id} currentUserId={me.id} onClose={() => setChannelInfoOpen(false)} />
      )}

      {/* ── Pinned Messages panel (right sidebar) ─────────────── */}
      {channel && (
        <PinnedMessagesPanel
          channelId={channel.id}
          open={pinnedPanelOpen}
          onClose={() => setPinnedPanelOpen(false)}
          userNames={Object.fromEntries(
            Object.entries(userMap).map(([id, u]) => [id, displayName(u)])
          )}
        />
      )}
      </>
      )}

      {/* ── Thread pane ─────────────────────────────────────────── */}
      {threadRoot && (
        <ThreadPanel rootPost={threadRoot} channelTitle={channelTitle}
          channelType={channel?.type} me={me} userMap={userMap}
          teamMembers={teamMembers} onClose={() => setThreadRoot(null)}
          onResolveUsers={resolveUsers} />
      )}

      {/* ── Command palette ──────────────────────────────────────── */}
      <CommandPalette open={cmdPaletteOpen} onClose={() => setCmdPaletteOpen(false)} items={cmdItems} />

      {/* ── Message search ───────────────────────────────────────── */}
      <SearchPanel
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        workspaceId={activeTeamId}
        onPick={hit => {
          const match = channels.find(c => c.id === hit.channel_id)
          if (match) { setChannel(match); setChannelsOpen(false) }
        }}
      />

      {/* ── Backdrop for mobile channel slide-over ──────────────── */}
      <button type="button" className="app-shell-backdrop" tabIndex={-1}
        aria-label="Close channels" onClick={() => setChannelsOpen(false)} />

      {/* ── Browse channels modal ──────────────────────────────── */}
      <ChannelBrowseModal
        workspaceId={activeTeamId}
        open={channelBrowseOpen}
        onClose={() => setChannelBrowseOpen(false)}
        onJoined={(ch) => {
          setChannelBrowseOpen(false)
          // Refresh channel list
          void (async () => {
            const r = await apiFetch(`/api/channels?team_id=${encodeURIComponent(activeTeamId)}`)
            if (r.ok) {
              const data = await r.json() as { channels?: Channel[] }
              setChannels(data.channels ?? [])
              const joined = (data.channels ?? []).find(c => c.id === ch.id)
              if (joined) setChannel(joined)
            }
          })()
        }}
      />

      {/* ── Custom emoji panel ─────────────────────────────────── */}
      <CustomEmojiPanel
        open={emojiPanelOpen}
        onClose={() => setEmojiPanelOpen(false)}
        workspaceId={activeTeamId}
      />

      {/* ── Leave channel confirmation ─────────────────────────── */}
      {leaveConfirmChannelId && (
        <div className="mm-modal-overlay" role="presentation" onClick={() => setLeaveConfirmChannelId(null)}>
          <div className="mm-modal" role="alertdialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            <h2>Leave channel?</h2>
            <p className="mm-editor-hint" style={{ marginTop: 8 }}>
              Are you sure you want to leave <strong>{channels.find(c => c.id === leaveConfirmChannelId)?.display_name || 'this channel'}</strong>? You can rejoin it later from the channel browser.
            </p>
            <div className="mm-modal-actions">
              <button type="button" className="ghost-button" onClick={() => setLeaveConfirmChannelId(null)}>Cancel</button>
              <button type="button" className="slack-button" style={{ background: '#D24B4E' }}
                onClick={async () => {
                  const chId = leaveConfirmChannelId
                  setLeaveConfirmChannelId(null)
                  await apiFetch(`/api/channel-members?channel_id=${encodeURIComponent(chId)}&user_id=me`, { method: 'DELETE' })
                  setChannels(prev => prev.filter(c => c.id !== chId))
                  if (channel?.id === chId) setChannel(null)
                }}>Leave Channel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create channel modal ────────────────────────────────── */}
      {newChannelOpen ? (
        <div className="modal-overlay" role="presentation" onClick={() => !channelBusy && setNewChannelOpen(false)}>
          <div className="modal-panel slack-card" role="dialog" aria-modal="true"
            aria-labelledby="new-channel-title" onClick={e => e.stopPropagation()}>
            <h2 id="new-channel-title" style={{ marginTop: 0 }}>Create channel</h2>
            <label className="field-label">Display name
              <input className="slack-input" value={newChannelDisplay}
                onChange={e => setNewChannelDisplay(e.target.value)} placeholder="e.g. Engineering" />
            </label>
            <label className="field-label" style={{ marginTop: 12 }}>URL name (optional)
              <input className="slack-input" value={newChannelSlug}
                onChange={e => setNewChannelSlug(e.target.value)} placeholder="Auto from display name if empty" />
            </label>
            <label className="field-label" style={{ marginTop: 12 }}>Purpose (optional)
              <textarea className="slack-input" value={newChannelPurpose}
                onChange={e => setNewChannelPurpose(e.target.value)}
                placeholder="What is this channel about?"
                rows={2}
                style={{ resize: 'vertical', minHeight: 48, fontFamily: 'inherit' }} />
            </label>
            <label className="field-label" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={newChannelPrivate} onChange={e => setNewChannelPrivate(e.target.checked)} />
              <span>Make private (invite only)</span>
            </label>
            {channelFormError ? <p className="form-error">{channelFormError}</p> : null}
            <div className="modal-actions">
              <button type="button" className="ghost-button" onClick={() => !channelBusy && setNewChannelOpen(false)}>Cancel</button>
              <button type="button" className="slack-button" disabled={channelBusy}
                onClick={() => void createChannel()}>{channelBusy ? 'Creating…' : 'Create'}</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Delete message confirmation modal ───────────────────── */}
      {pendingDeleteMsg && (
        <div className="mm-modal-overlay" role="presentation" onClick={() => setPendingDeleteMsg(null)}>
          <div className="mm-modal" role="alertdialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            <h2>Delete message?</h2>
            <p className="mm-editor-hint" style={{ marginTop: 8 }}>
              Are you sure you want to delete this message? This action cannot be undone.
            </p>
            <div className="mm-modal-actions">
              <button type="button" className="ghost-button" onClick={() => setPendingDeleteMsg(null)}>Cancel</button>
              <button type="button" className="slack-button" style={{ background: '#D24B4E' }}
                onClick={() => void performDeleteMsg()}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Forward message modal ──────────────────────────────── */}
      <ForwardMessageModal
        open={!!forwardMsg}
        messageBody={forwardMsg?.message || ''}
        originalAuthor={forwardMsg ? (userMap[forwardMsg.user_id] ? displayName(userMap[forwardMsg.user_id]) : forwardMsg.user_id) : ''}
        currentWorkspaceId={activeTeamId}
        onClose={() => setForwardMsg(null)}
      />

      {/* ── Keyboard shortcuts modal ──────────────────────────── */}
      <KeyboardShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {/* ── Global message search modal ─────────────────────────── */}
      <GlobalSearchModal
        open={globalSearchOpen}
        onClose={() => setGlobalSearchOpen(false)}
        workspaceId={activeTeamId}
        onJumpToMessage={(channelId) => {
          const match = channels.find(c => c.id === channelId)
          if (match) { setChannel(match); setChannelsOpen(false) }
        }}
      />

      {/* ── Quick Switcher (Cmd+K) ────────────────────────────── */}
      <QuickSwitcher
        open={quickSwitcherOpen}
        onClose={() => setQuickSwitcherOpen(false)}
        channels={channels}
        teamMembers={teamMembers}
        workspaceId={activeTeamId}
        onSelectChannel={ch => { setChannel(ch); setChannelsOpen(false) }}
        onSelectDm={uid => void openDm(uid)}
      />

      {/* ── User profile card popup ────────────────────────────── */}
      {profileUserId && userMap[profileUserId] && (
        <>
          <button type="button" className="user-profile-backdrop" onClick={() => setProfileUserId(null)} aria-label="Close profile" />
          <UserProfileCard
            user={userMap[profileUserId]}
            presenceStatus={getStatus(profileUserId)}
            onClose={() => setProfileUserId(null)}
            onStartDm={uid => { void openDm(uid); setProfileUserId(null) }}
          />
        </>
      )}

      {newMessageOpen && (
        <NewMessageModal
          open={newMessageOpen}
          onClose={() => setNewMessageOpen(false)}
          users={teamMembers}
          meId={me?.id || ''}
          onStartChat={startChat}
        />
      )}

      {/* ── Settings Drawer (Slack-style fullscreen overlay) ── */}
      {settingsDrawerOpen && (
        <>
          <div className="settings-drawer-backdrop" onClick={() => setSettingsDrawerOpen(false)} />
          <div className="settings-drawer" role="dialog" aria-modal="true" aria-label="Settings"
            onKeyDown={e => { if (e.key === 'Escape') setSettingsDrawerOpen(false) }}>
            <div className="settings-drawer-header">
              <h2>Preferences</h2>
              <button type="button" className="settings-drawer-close"
                onClick={() => setSettingsDrawerOpen(false)} aria-label="Close settings">
                <X size={20} />
              </button>
            </div>
            <div className="settings-drawer-body">
              <SettingsShell variant="drawer" onClose={() => setSettingsDrawerOpen(false)} />
            </div>
          </div>
        </>
      )}

      {/* ── Channel Notification Preferences ─────────────── */}
      {channel && (
        <ChannelNotifPrefsModal
          channelId={channel.id}
          channelName={channel.display_name || channel.name}
          open={channelNotifPrefsOpen}
          onClose={() => setChannelNotifPrefsOpen(false)}
        />
      )}

      {/* ── Custom Status Popup (Slack-style) ──────────────── */}
      {customStatusOpen && (
        <>
          <div className="ws-menu-backdrop" onClick={() => setCustomStatusOpen(false)} />
          <div className="aae-auth-modal-overlay" onClick={() => setCustomStatusOpen(false)}>
            <div className="custom-status-popup" style={{
              position: 'relative', bottom: 'auto', left: 'auto', right: 'auto',
              maxWidth: 420, width: '100%', margin: '0 auto'
            }} onClick={e => e.stopPropagation()}>
              <h4>Set a status</h4>
              <div className="custom-status-row">
                <button type="button" className="custom-status-emoji-btn"
                  onClick={() => {
                    const emojis = ['😊', '🏠', '🌴', '🤒', '🚀', '📅', '🎯', '💬', '🔇', '⛔']
                    const idx = emojis.indexOf(customStatusEmoji)
                    setCustomStatusEmoji(emojis[(idx + 1) % emojis.length])
                  }}>
                  {customStatusEmoji || '😊'}
                </button>
                <input type="text" className="custom-status-input"
                  placeholder="What's your status?"
                  value={customStatusText}
                  onChange={e => setCustomStatusText(e.target.value)}
                  maxLength={64}
                  autoFocus />
              </div>
              <div className="custom-status-presets">
                {([
                  { emoji: '📅', text: 'In a meeting' },
                  { emoji: '🚌', text: 'Commuting' },
                  { emoji: '🤒', text: 'Out sick' },
                  { emoji: '🌴', text: 'Vacationing' },
                  { emoji: '🏠', text: 'Working remotely' },
                  { emoji: '🔇', text: 'Focusing' }
                ]).map(p => (
                  <button key={p.text} type="button" className="custom-status-preset"
                    onClick={() => { setCustomStatusEmoji(p.emoji); setCustomStatusText(p.text) }}>
                    <span>{p.emoji}</span> {p.text}
                  </button>
                ))}
              </div>
              <div className="custom-status-actions">
                <button type="button" className="ghost-button" style={{ fontSize: 13 }}
                  onClick={async () => {
                    setCustomStatusEmoji('')
                    setCustomStatusText('')
                    await apiFetch('/api/auth/me', {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status_emoji: '', status_text: '' })
                    })
                    setCustomStatusOpen(false)
                  }}>
                  Clear status
                </button>
                <button type="button" className="slack-button" style={{ fontSize: 13 }}
                  onClick={async () => {
                    await apiFetch('/api/auth/me', {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        status_emoji: customStatusEmoji || '😊',
                        status_text: customStatusText
                      })
                    })
                    setCustomStatusOpen(false)
                  }}>
                  Save
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Invite Members Modal (Slack-style) ─────────────── */}
      {inviteModalOpen && (
        <>
          <div className="ws-menu-backdrop" onClick={() => setInviteModalOpen(false)} />
          <div className="aae-auth-modal-overlay" onClick={() => setInviteModalOpen(false)}>
            <div className="invite-modal" onClick={e => e.stopPropagation()}>
              <div className="invite-modal-header">
                <h3>Invite people to {activeTeam?.display_name || 'workspace'}</h3>
                <button type="button" className="mm-icon-btn" onClick={() => setInviteModalOpen(false)} aria-label="Close">
                  <X size={18} />
                </button>
              </div>
              <div className="invite-modal-body">
                <p className="invite-modal-desc">
                  Share this link with colleagues so they can join your workspace. The link expires in 7 days.
                </p>
                {inviteBusy ? (
                  <div className="invite-modal-loading">
                    <span className="module-loading">Generating invite link…</span>
                  </div>
                ) : inviteUrl ? (
                  <div className="invite-modal-link-wrap">
                    <div className="invite-modal-link-box">
                      <Link2 size={15} style={{ flexShrink: 0, color: 'var(--mm-link)' }} />
                      <span className="invite-modal-link-text">{inviteUrl}</span>
                    </div>
                    <button type="button" className="slack-button invite-modal-copy-btn"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(inviteUrl)
                          setInviteCopied(true)
                          setTimeout(() => setInviteCopied(false), 2500)
                        } catch { /* fallback */ }
                      }}>
                      {inviteCopied ? <><Check size={14} /> Copied!</> : <><Copy size={14} /> Copy link</>}
                    </button>
                  </div>
                ) : (
                  <p style={{ color: 'var(--mm-muted)', fontSize: 13 }}>Could not generate invite link. You may not have permission.</p>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Sidebar Customizer (Slack-style) ───────────────── */}
      {sidebarCustomizerOpen && (
        <>
          <div className="sidebar-customizer-overlay" onClick={() => setSidebarCustomizerOpen(false)} />
          <div className="sidebar-customizer" role="dialog" aria-modal="true" aria-label="Customize sidebar">
            <div className="sidebar-customizer-header">
              <h3>Customize your sidebar</h3>
              <button type="button" className="mm-icon-btn" onClick={() => setSidebarCustomizerOpen(false)} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="sidebar-customizer-body">
              <p style={{ padding: '0 18px 8px', margin: 0, fontSize: 12, color: 'var(--mm-muted)' }}>
                Toggle sections to show or hide them in your sidebar.
              </p>
              {sidebarSections.map((section, idx) => (
                <div key={section.key} className="sidebar-customizer-item">
                  <GripVertical size={16} className="grip-icon" />
                  <span style={{ fontSize: 16, width: 22, textAlign: 'center' }}>{section.icon}</span>
                  <span className="item-label">{section.label}</span>
                  <button
                    type="button"
                    className={`item-toggle${section.enabled ? ' active' : ''}`}
                    aria-label={`Toggle ${section.label}`}
                    onClick={() => {
                      setSidebarSections(prev => {
                        const next = [...prev]
                        next[idx] = { ...next[idx], enabled: !next[idx].enabled }
                        try { localStorage.setItem('aaelink_sidebar_sections', JSON.stringify(next)) } catch {}
                        return next
                      })
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </main>
  )
}

export default function HomePage() {
  return (
    <Suspense fallback={<main className="app-shell-loading"><p>Loading workspace…</p></main>}>
      <HomeChat />
    </Suspense>
  )
}
