'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Menu, Search, Hash, Lock, MessageCircle, ChevronDown, ChevronUp, Plus, MessageSquare, Bookmark, FileText, Settings, ShieldAlert, AlignLeft, Users, LogOut, UserPlus, Paintbrush, CircleDot } from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'
import { isPlatformAdmin } from '@/lib/platformRole'
import { notifyDesktopChatMessage } from '@/lib/desktopNotify'
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
import { SearchPanel } from '@/app/components/chat/SearchPanel'
import type { ReactionSummary } from '@/lib/reactions'
import type { SlashMeUser } from '@/lib/composerSlash'
import { enqueueMessage, startOutboxFlushListener } from '@/lib/outboxQueue'
import { TicketsPanel } from '@/app/components/TicketsPanel'
import { DocumentsPanel } from '@/app/components/DocumentsPanel'

interface Channel {
  id: string
  name: string
  display_name: string
  team_id: string
  type?: string
  unread_count?: number
  dm_peer_display?: string
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

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault()
    const next = !open
    setOpen(next)
    localStorage.setItem(`sidebar_section_${id}`, String(next))
  }

  return (
    <details className="channel-section" open={open}>
      <summary className="channel-section-head" onClick={toggle}>
        <div className="section-title-wrap">
          <ChevronDown size={14} className="section-chevron" style={{ transform: open ? 'none' : 'rotate(-90deg)' }} />
          <p>{title}</p>
        </div>
        {onAdd && (
          <button type="button" className="channel-add" onClick={(e) => { e.stopPropagation(); onAdd(); }}>
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
  const sinceMsRef = useRef(0)
  const meRef = useRef<AppUser | null>(null)
  const userMapRef = useRef<Record<string, AppUser>>({})
  const timelineRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<ComposerHandle>(null)

  // ── Presence heartbeat & listener ───────────────────────────────────────
  usePresenceHeartbeat()
  const { getStatus } = usePresenceListener(activeTeamId)

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

  useEffect(() => { loadChannels() }, [loadChannels])

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

  // ── Create channel ──────────────────────────────────────────────────────
  async function createChannel() {
    setChannelFormError('')
    const display_name = newChannelDisplay.trim()
    if (!display_name || !activeTeamId) { setChannelFormError('Enter a channel name.'); return }
    setChannelBusy(true)
    const res = await apiFetch('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: activeTeamId, display_name, name: newChannelSlug.trim() || undefined })
    })
    setChannelBusy(false)
    if (!res.ok) { setChannelFormError('Could not create channel.'); return }
    const data = (await res.json()) as { channel?: Channel }
    setNewChannelOpen(false); setNewChannelDisplay(''); setNewChannelSlug('')
    loadChannels()
    if (data?.channel?.id) setChannel(data.channel)
  }

  // ── Create DM ───────────────────────────────────────────────────────────
  const openDm = useCallback(async (peerId: string) => {
    if (!activeTeamId) return
    const res = await apiFetch('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: activeTeamId, type: 'D', peer_user_id: peerId })
    })
    if (!res.ok) return
    const data = (await res.json()) as { channel?: Channel }
    if (data?.channel) {
      loadChannels()
      setChannel(data.channel)
      setChannelsOpen(false)
    }
  }, [activeTeamId, loadChannels])

  const channelTitle = channel?.display_name || channel?.name || 'channel'
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
      { id: 'nav-settings', group: 'Account', label: 'Settings', icon: 'settings', run: () => router.push('/settings') },
      { id: 'nav-workspaces', group: 'Account', label: 'All Workspaces', icon: 'workspaces', run: () => router.push('/workspaces') }
    )
    if (me && isPlatformAdmin(me.platform_role)) {
      list.push({ id: 'nav-admin', group: 'Account', label: 'Admin Panel', icon: 'admin', run: () => router.push('/admin') })
    }
    return list
  }, [channels, me, router])

  // ── ⌘K / Ctrl+K: command palette shortcut ───────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCmdPaletteOpen(v => !v)
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
                <button type="button" className="ws-dropdown-item" onClick={() => { setWsMenuOpen(false); /* invite flow */ }}>
                  <UserPlus size={16} /> Invite people to {activeTeam?.display_name || 'workspace'}
                </button>
                <button type="button" className="ws-dropdown-item" onClick={() => { setWsMenuOpen(false); router.push('/settings') }}>
                  <Settings size={16} /> Preferences
                </button>
                <button type="button" className="ws-dropdown-item" onClick={() => { setWsMenuOpen(false); }}>
                  <Paintbrush size={16} /> Customize sidebar
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

          <SidebarSection id="channels" title="Channels" onAdd={() => setNewChannelOpen(true)}>
            {channels.filter(c => c.type !== 'D').map(item => (
              <button type="button"
                className={`channel${channel?.id === item.id && !activeModule ? ' active' : ''}${(item.unread_count ?? 0) > 0 ? ' channel--unread' : ''}`}
                key={item.id}
                onClick={() => { setChannel(item); setChannelsOpen(false); router.push(`/home?team=${encodeURIComponent(activeTeamId)}`) }}>
                <Hash size={15} className="channel-icon" />
                <span className="channel-name">{item.display_name || item.name}</span>
                {(item.unread_count ?? 0) > 0 ? (
                  <span className="channel-unread">{item.unread_count}</span>
                ) : null}
              </button>
            ))}
          </SidebarSection>

          <SidebarSection id="dms" title="Direct messages">
            {channels.filter(c => c.type === 'D').map(item => {
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
                <CircleDot size={10} /> Active
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
                <button type="button" className="ws-dropdown-item" onClick={() => { setUserMenuOpen(false); router.push('/settings') }}>
                  <Settings size={16} /> Profile &amp; preferences
                </button>
                {me && isPlatformAdmin(me.platform_role) ? (
                  <Link href="/admin" className="ws-dropdown-item" onClick={() => setUserMenuOpen(false)}>
                    <ShieldAlert size={16} /> Administration
                  </Link>
                ) : null}
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
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mm-muted)' }}>
            <div style={{ textAlign: 'center' }}>
              <MessageSquare size={48} style={{ opacity: 0.5, marginBottom: 16 }} />
              <h2>No threads yet</h2>
              <p>When you reply to a message in a channel, it will show up here.</p>
            </div>
          </div>
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
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mm-muted)' }}>
            <div style={{ textAlign: 'center' }}>
              <Bookmark size={48} style={{ opacity: 0.5, marginBottom: 16 }} />
              <h2>No saved items</h2>
              <p>Save messages to easily find them later.</p>
            </div>
          </div>
        </section>
      ) : (
        <>
        <section className="chat-pane">
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
            <h1>{channel?.type === 'D' ? '' : '# '}{channelTitle}</h1>
          </div>
          <div className="chat-header-nav">
            <button type="button" className="mm-icon-btn" title="Search messages"
              aria-label="Search messages" onClick={() => setSearchOpen(true)}>
              <Search size={18} aria-hidden />
            </button>
            <NotificationsBell enabled={Boolean(me)} />
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
                {channel?.type === 'D' ? <Users size={36} /> : <Hash size={36} />}
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
