'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Menu, Search, Hash, Lock, ChevronDown, Plus, MessageSquare, Bookmark, Settings, Users, Info, Pin, Star, BellOff, Keyboard, Book, Package, PenLine, Paperclip, Zap, Key, Bell, Activity, PackageOpen, Ticket, FileText, LayoutGrid, Shield, Phone } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { notifyDesktopChatMessage } from '@/lib/notifications/desktopNotify'
import { playNotificationSound } from '@/lib/notifications/notificationSound'
import { connectCollab, type ChatPost, type CollabDeletion, type ReadReceipt } from '@/lib/realtime/realtime'
import { connectWsCollab } from '@/lib/realtime/wsClient'
import { createRealtimeEventBus } from '@/lib/realtime/realtimeEventBus'
import { applyReadReceiptEvent, applyReadReceiptMap, routeChannelUpdate } from '@/components/chat/realtimeEventApply'
import { cachePosts, readCachedPosts, removeCachedPosts, setChannelMeta, pruneChannel } from '@/lib/messaging/messageCache'
import { ChatMessage, type AppUser, displayName } from '@/components/chat/ChatMessage'
import { SystemMessage, isSystemPost } from '@/components/chat/SystemMessage'
import { Composer, type ComposerHandle } from '@/components/chat/Composer'
import { TypingIndicator, useTypingEmitter } from '@/components/chat/TypingIndicator'
import { ThreadPanel } from '@/components/chat/ThreadPanel'
import { usePresenceHeartbeat } from '@/components/chat/usePresenceHeartbeat'
import { usePresenceListener } from '@/components/chat/usePresenceListener'
import { useReadState } from '@/components/chat/useReadState'
import { useVirtualTimeline } from '@/components/chat/useVirtualTimeline'
import { DateSeparator, JumpToDate } from '@/components/chat/DateSeparator'
import { NotificationsBell } from '@/components/notifications/NotificationsBell'
import { NewMessageModal } from '@/components/modals/NewMessageModal'
import { SearchPanel } from '@/components/chat/SearchPanel'
import type { ReactionSummary } from '@/lib/messaging/reactions'
import type { SlashMeUser } from '@/lib/messaging/composerSlash'
import { enqueueMessage, startOutboxFlushListener } from '@/lib/infra/outboxQueue'
import { ChannelInfoPanel } from '@/components/channels/ChannelInfoPanel'
import { BookmarkBar } from '@/components/shared/BookmarkBar'
import { ChannelTopicInline } from '@/components/chat/ChannelTopicInline'
import { PinnedMessagesPanel } from '@/components/shared/PinnedMessagesPanel'
import { UpdateBanner } from '@/components/shared/UpdateBanner'
import { NotificationPermissionBanner } from '@/components/notifications/NotificationPermissionBanner'
import { ChannelNotifPrefsModal } from '@/components/channels/ChannelNotifPrefsModal'
import { UserProfilePanel } from '@/components/user/UserProfilePanel'
import { UserHovercard } from '@/components/user/UserHovercard'
import { KeyboardShortcutsModal } from '@/components/modals/KeyboardShortcutsModal'
import { ForwardMessageModal } from '@/components/chat/ForwardMessageModal'
import { readStarredChannels, toggleStarChannel } from '@/lib/channels/channelStars'
import {
  loadChannelCategories,
  moveChannelToSection,
  removeChannelFromSection,
  sectionKey,
  type ChannelCategoryRow,
} from '@/lib/channels/sidebarSections'
import { getChannelIdsWithDrafts } from '@/lib/messaging/messageDrafts'
import { GlobalSearchModal } from '@/components/search/GlobalSearchModal'
import { QuickSwitcher, type QuickSwitchAction } from '@/components/search/QuickSwitcher'
import { PreferencesModal } from '@/components/modals/PreferencesModal'
import { ChannelHeaderDropdown } from '@/components/chat/ChannelHeaderDropdown'
import { ChannelBrowseModal } from '@/components/channels/ChannelBrowseModal'
import CustomEmojiPanel from '@/components/shared/CustomEmojiPanel'
import { MessageSkeleton } from '@/components/chat/MessageSkeleton'
import { useAutoAway } from '@/lib/ui/useAutoAway'
import { useStatusExpiry } from '@/lib/ui/useStatusExpiry'
import { isDndActive } from '@/lib/comms/dndSchedule'
import { evaluateNotification } from '@/lib/notifications/notificationSchedule'
import AudioVideoClipRecorder from '@/components/media/AudioVideoClipRecorder'
import FileBrowserPanel from '@/components/media/FileBrowserPanel'
import { ModuleRenderer } from './ModuleRenderer'
import { MORE_MODULE_KEYS } from './sidebarNav'
import { InviteModal } from './InviteModal'
import { CustomStatusPopup } from './CustomStatusPopup'
import { SidebarCustomizer } from './SidebarCustomizer'
import { CreateChannelModal } from './CreateChannelModal'
import { WorkspaceDropdown } from './WorkspaceDropdown'
import { UserFooter } from './UserFooter'
import { ConfirmDialog } from './ConfirmDialog'
import { MemberListPanel } from './MemberListPanel'
import { ChatHeader } from './ChatHeader'
import { MessageTimeline } from './MessageTimeline'
import { ChannelSidebar, readSidebarWidth } from './ChannelSidebar'
import { useMessageKeyNav } from '@/components/chat/useMessageKeyNav'
import { ToastProvider } from '@/components/shared/ToastProvider'
import { MessageContextMenu, type MessageContextMenuState } from '@/components/chat/MessageContextMenu'

interface Channel {
  id: string
  name: string
  display_name: string
  team_id: string
  type?: string
  unread_count?: number
  mention_count?: number
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

/* SidebarSection is now in ChannelSidebar.tsx */

function HomeChat() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeModule = searchParams.get('module') || null
  // Read the persisted sidebar width synchronously so the grid track and aside
  // width are correct on the very first render frame (no flash). The lazy
  // initializer only runs on the client; on SSR window is undefined so
  // readSidebarWidth returns null and the CSS default (260px) applies.
  const [initialSidebarWidth] = useState<number | null>(() => readSidebarWidth())

  const [teams, setTeams] = useState<Team[]>([])
  const [activeTeamId, setActiveTeamId] = useState('')
  const [channels, setChannels] = useState<Channel[]>([])
  const [channel, setChannel] = useState<Channel | null>(null)
  const [posts, setPosts] = useState<ChatPost[]>([])
  const [postsLoading, setPostsLoading] = useState(false)
  const [olderAvailable, setOlderAvailable] = useState(false)
  const [olderLoading, setOlderLoading] = useState(false)
  const [streamUp, setStreamUp] = useState(false)
  const [me, setMe] = useState<AppUser | null>(null)
  const [userMap, setUserMap] = useState<Record<string, AppUser>>({})
  const [teamMembers, setTeamMembers] = useState<AppUser[]>([])
  const [newChannelOpen, setNewChannelOpen] = useState(false)
  const [channelsOpen, setChannelsOpen] = useState(false)
  const [threadRoot, setThreadRoot] = useState<ChatPost | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [memberListOpen, setMemberListOpen] = useState(false)
  const [wsMenuOpen, setWsMenuOpen] = useState(false)

  const [pendingDeleteMsg, setPendingDeleteMsg] = useState<ChatPost | null>(null)
  const [channelInfoOpen, setChannelInfoOpen] = useState(false)
  const [profilePaneId, setProfilePaneId] = useState<string | null>(null)
  const [forwardMsg, setForwardMsg] = useState<ChatPost | null>(null)
  const [forwardTarget, setForwardTarget] = useState('')
  const [forwardBusy, setForwardBusy] = useState(false)
  const [newMessageOpen, setNewMessageOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false)
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set())
  const [draftIds, setDraftIds] = useState<Set<string>>(new Set())
  const [preferencesModalOpen, setPreferencesModalOpen] = useState(false)
  const [customStatusOpen, setCustomStatusOpen] = useState(false)
  const [channelNotifPrefsOpen, setChannelNotifPrefsOpen] = useState(false)
  const [pinnedPanelOpen, setPinnedPanelOpen] = useState(false)
  const [filesPaneOpen, setFilesPaneOpen] = useState(false)
  const [msgContextMenu, setMsgContextMenu] = useState<MessageContextMenuState | null>(null)

  /**
   * Right-rail stacking model (Slack-style). The THREAD pane is independent
   * and may coexist with exactly ONE "secondary" info pane. The secondary
   * group — channelInfo / pinned / memberList / profile — is mutually
   * exclusive *among itself* but NOT versus the thread. Openers for a
   * secondary pane call this first to evict the previously-open secondary,
   * leaving any open thread untouched.
   */
  const closeSecondaryPanes = useCallback(() => {
    setChannelInfoOpen(false)
    setPinnedPanelOpen(false)
    setMemberListOpen(false)
    setProfilePaneId(null)
    setFilesPaneOpen(false)
  }, [])

  /**
   * Toggle a single secondary pane on/off. When turning one ON, every other
   * secondary pane is closed first (group exclusivity); the thread pane is
   * left as-is so thread + one info pane can stack.
   */
  const toggleChannelInfo = useCallback(() => {
    setChannelInfoOpen(prev => {
      if (prev) return false
      setPinnedPanelOpen(false)
      setMemberListOpen(false)
      setProfilePaneId(null)
      setFilesPaneOpen(false)
      return true
    })
  }, [])
  const togglePinnedPanel = useCallback(() => {
    setPinnedPanelOpen(prev => {
      if (prev) return false
      setChannelInfoOpen(false)
      setMemberListOpen(false)
      setProfilePaneId(null)
      setFilesPaneOpen(false)
      return true
    })
  }, [])
  const toggleMemberList = useCallback(() => {
    setMemberListOpen(prev => {
      if (prev) return false
      setChannelInfoOpen(false)
      setPinnedPanelOpen(false)
      setProfilePaneId(null)
      setFilesPaneOpen(false)
      return true
    })
  }, [])
  const toggleFilesPane = useCallback(() => {
    setFilesPaneOpen(prev => {
      if (prev) return false
      setChannelInfoOpen(false)
      setPinnedPanelOpen(false)
      setMemberListOpen(false)
      setProfilePaneId(null)
      return true
    })
  }, [])

  /**
   * Force the channel-info pane open (always on, never a toggle). Evicts the
   * other secondary panes; leaves the thread pane intact. Used by deep
   * "open channel info" affordances (empty-state CTAs).
   */
  const openChannelInfo = useCallback(() => {
    setPinnedPanelOpen(false)
    setMemberListOpen(false)
    setProfilePaneId(null)
    setFilesPaneOpen(false)
    setChannelInfoOpen(true)
  }, [])

  /**
   * Open the profile pane. Replaces any other *secondary* rail surface but
   * keeps the thread pane open so the two can stack.
   * URL is synced separately via the effect below so deep-links work.
   */
  const openProfilePane = useCallback((uid: string) => {
    closeSecondaryPanes()
    setProfilePaneId(uid)
  }, [closeSecondaryPanes])

  // Open preferences from query string (?prefs=1) — used by the /settings redirect
  useEffect(() => {
    if (searchParams.get('prefs') === '1') {
      setPreferencesModalOpen(true)
      // Strip the query param so refreshing doesn't reopen.
      const params = new URLSearchParams(searchParams.toString())
      params.delete('prefs')
      const qs = params.toString()
      router.replace(qs ? `/home?${qs}` : '/home')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Open profile pane from query string (?profile=USER_ID). Deep-linkable.
  // Reads on mount; subsequent state changes are pushed back into the URL by
  // the second effect below so reload / share / back-button all work.
  useEffect(() => {
    const initial = searchParams.get('profile')
    if (initial) setProfilePaneId(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync profilePaneId → URL. router.replace preserves history (no extra
  // navigations on every open/close).
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    if (profilePaneId) {
      if (params.get('profile') === profilePaneId) return
      params.set('profile', profilePaneId)
    } else {
      if (!params.has('profile')) return
      params.delete('profile')
    }
    const qs = params.toString()
    router.replace(qs ? `/home?${qs}` : '/home')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profilePaneId])

  const [inviteModalOpen, setInviteModalOpen] = useState(false)
  const [inviteUrl, setInviteUrl] = useState('')
  const [inviteBusy, setInviteBusy] = useState(false)

  const [sidebarCustomizerOpen, setSidebarCustomizerOpen] = useState(false)
  const [showJumpBottom, setShowJumpBottom] = useState(false)
  const [newMsgCount, setNewMsgCount] = useState(0)
  const [pageDragOver, setPageDragOver] = useState(false)
  const pageDragCounter = useRef(0)
  const [unreadSepId, setUnreadSepId] = useState<string | null>(null)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [clipRecorder, setClipRecorder] = useState<{ mode: 'audio' | 'video' } | null>(null)
  const [sidebarSections, setSidebarSections] = useState([
    { key: 'starred', label: 'Starred', iconKey: 'star', enabled: true },
    { key: 'channels', label: 'Channels', iconKey: 'hash', enabled: true },
    { key: 'direct', label: 'Direct Messages', iconKey: 'message_square', enabled: true },
    { key: 'enterprise', label: 'Enterprise', iconKey: 'package', enabled: true },
    { key: 'administration', label: 'Administration', iconKey: 'shield', enabled: true },
    { key: 'people', label: 'People', iconKey: 'users', enabled: true }
  ])
  const sinceMsRef = useRef(0)
  const meRef = useRef<AppUser | null>(null)
  const userMapRef = useRef<Record<string, AppUser>>({})

  // ── WS-event handler refs (populated below; the WS hook reads them via
  //    the ref pattern so its dependency array stays minimal). ────────
  const refetchReactionsDebouncedRef = useRef<((messageId: string) => void) | null>(null)
  const refetchChannelsDebouncedRef = useRef<(() => void) | null>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<ComposerHandle>(null)

  // ── Presence heartbeat & listener ───────────────────────────────────────
  usePresenceHeartbeat()
  useAutoAway()
  useStatusExpiry(!!me)
  // ── Realtime event bus (typing + presence) ─────────────────────────
  // Live when `NEXT_PUBLIC_WS_GATEWAY_URL` is set; otherwise undefined and the
  // legacy SSE / GET-poll consumers stay in charge.
  const realtimeBus = useMemo(() => {
    if (typeof process === 'undefined' || !process.env.NEXT_PUBLIC_WS_GATEWAY_URL) {
      return undefined
    }
    return createRealtimeEventBus()
  }, [])
  const { getStatus } = usePresenceListener(activeTeamId, realtimeBus)
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
      const away = distFromBottom > 200
      setShowJumpBottom(away)
      if (!away) setNewMsgCount(0)
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

  // ── Bootstrap: single round-trip mount payload (v0.0.41) ──────────────
  //
  // Fills `teams`, `me`, `userMap`, `teamMembers`, and `channels` from one
  // server-side parallelized query batch. The fine-grained effects below
  // (workspaces, auth/me, members, channels) still run after this, but
  // when bootstrap succeeds they re-fetch already-warm data — usually a
  // no-op as far as the user can perceive.
  useEffect(() => {
    let cancelled = false
    const fromUrl = searchParams.get('team') || ''
    const url = fromUrl
      ? `/api/bootstrap?workspace_id=${encodeURIComponent(fromUrl)}`
      : '/api/bootstrap'
    void (async () => {
      try {
        const r = await apiFetch(url, { method: 'GET' })
        if (r.status === 401) { router.replace('/login'); return }
        if (!r.ok || cancelled) return
        const data = (await r.json()) as {
          user?: AppUser
          teams?: Team[]
          channels?: Channel[]
          members?: AppUser[]
          workspace_id?: string | null
        }
        if (cancelled) return
        if (data.user) {
          setMe(data.user)
          setUserMap(prev => ({ ...prev, [data.user!.id]: data.user! }))
        }
        if (Array.isArray(data.teams)) setTeams(data.teams)
        if (Array.isArray(data.members)) {
          setTeamMembers(data.members)
          setUserMap(prev => {
            const next = { ...prev }
            for (const u of data.members ?? []) next[u.id] = u
            return next
          })
        }
        if (Array.isArray(data.channels)) setChannels(data.channels)
      } catch { /* fine-grained fallbacks pick up the slack below */ }
    })()
    return () => { cancelled = true }
  }, [router, searchParams])

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
  const loadTeamMembers = useCallback(async () => {
    if (!activeTeamId) return
    const r = await apiFetch(`/api/collab/workspace-members?workspace_id=${encodeURIComponent(activeTeamId)}`, { method: 'GET' })
    if (!r.ok) { setTeamMembers([]); return }
    const data = (await r.json()) as { users?: AppUser[] }
    setTeamMembers(data.users ?? [])
  }, [activeTeamId])

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

      // Merge mention counts from /api/channels/unread (audit §1.5 — distinguish
      // unread from mentioned-unread). Best-effort; if the call fails we just keep
      // unread_count on its own.
      try {
        const ru = await apiFetch(`/api/channels/unread?workspace_id=${encodeURIComponent(activeTeamId)}`)
        if (ru.ok) {
          const ud = (await ru.json()) as { channels?: Array<{ channel_id: string; mention_count: number; unread_count: number }> }
          const mentionMap = new Map<string, number>()
          for (const u of ud.channels ?? []) {
            mentionMap.set(u.channel_id, Number(u.mention_count) || 0)
          }
          for (const c of next) {
            const m = mentionMap.get(c.id)
            if (typeof m === 'number') c.mention_count = m
          }
        }
      } catch { /* ignore */ }

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
        // Supported:
        //   aaelink://workspace/<ws>/channel/<ch>
        //   aaelink://workspace/<ws>/ticket/<id>
        //   aaelink://workspace/<ws>/document/<id>
        //   aaelink://workspace/<ws>/template/<id>
        const parts = url.pathname.replace(/^\/+/, '').split('/')
        const wsIdx = parts.indexOf('workspace')
        if (wsIdx < 0 || !parts[wsIdx + 1]) return
        const wsId = parts[wsIdx + 1]

        const ticketIdx = parts.indexOf('ticket')
        if (ticketIdx >= 0 && parts[ticketIdx + 1]) {
          router.replace(`/tickets?team=${encodeURIComponent(wsId)}&ticket=${encodeURIComponent(parts[ticketIdx + 1])}`)
          return
        }
        const docIdx = parts.indexOf('document')
        if (docIdx >= 0 && parts[docIdx + 1]) {
          router.replace(`/documents?team=${encodeURIComponent(wsId)}&assembly=${encodeURIComponent(parts[docIdx + 1])}`)
          return
        }
        const tplIdx = parts.indexOf('template')
        if (tplIdx >= 0 && parts[tplIdx + 1]) {
          router.replace(`/documents?team=${encodeURIComponent(wsId)}&tab=templates&template=${encodeURIComponent(parts[tplIdx + 1])}`)
          return
        }

        const q = new URLSearchParams({ team: wsId })
        const chIdx = parts.indexOf('channel')
        if (chIdx >= 0 && parts[chIdx + 1]) q.set('ch', parts[chIdx + 1])
        router.replace(`/home?${q.toString()}`)
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
    setPostsLoading(true)
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
      setPostsLoading(false)
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
        const notifDecision = evaluateNotification(undefined, isDndActive())
        if (notifDecision.soundAllowed) playNotificationSound()
        // Set unread separator if the user is scrolled away
        const el = timelineRef.current
        if (el) {
          const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
          if (distFromBottom > 200) {
            setUnreadSepId(prev => prev || others[0]!.id)
            setNewMsgCount(c => c + others.length)
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

    // SSE / polling path read-receipt deltas: the server sends the full current
    // reader stack per touched message, so replace authoritatively. (The WS path
    // merges single `message_read` events in the `channel_update` case instead.)
    const onReadReceipts = (map: Record<string, ReadReceipt[]>) => {
      if (cancelled) return
      setPosts(cur => applyReadReceiptMap(cur, map))
    }

    const stop = (() => {
      const wsUrl =
        typeof process !== 'undefined' && process.env.NEXT_PUBLIC_WS_GATEWAY_URL
          ? process.env.NEXT_PUBLIC_WS_GATEWAY_URL
          : ''
      if (wsUrl) {
        // WS path — speaks the v0.0.35+ gateway protocol; resumes via the
        // last-seen cursor so events sent during a disconnect are replayed.
        const handle = connectWsCollab({
          url: wsUrl,
          channelId: channel.id,
          onConnected: up => { if (!cancelled) setStreamUp(up) },
          onEvent: ({ payload }) => {
            if (cancelled) return
            switch (payload.type) {
              case 'message': {
                // The gateway carries the published `ChatPost` opaquely as
                // `payload.payload`; coerce defensively so a malformed
                // server frame can never crash the client.
                const post = payload.payload as Partial<ChatPost> | null
                if (post && typeof post === 'object' && typeof post.id === 'string') {
                  onIncoming([post as ChatPost])
                }
                break
              }
              case 'deletion':
                onDeletions([{ id: payload.message_id, deleted_at: payload.deleted_at }])
                break
              case 'thread_update': {
                // Authoritative reply count from the server. Replaces the
                // optimistic +1 bump that `onIncoming` does when a thread
                // reply arrives directly; this fires when a reply lands on
                // a different node (multi-pod fan-out) or after a delete.
                const rootId = payload.root_id
                const next = payload.reply_count
                if (typeof rootId === 'string' && typeof next === 'number') {
                  setPosts(current =>
                    current.map(p => p.id === rootId ? { ...p, reply_count: next } : p)
                  )
                }
                break
              }
              case 'reaction': {
                // Gateway carries deltas; refetch the aggregate so the UI
                // matches the server's authoritative ReactionSummary[]. The
                // refetch is debounced per message id to coalesce bursts
                // (multiple users reacting in close succession).
                const messageId = payload.message_id
                if (typeof messageId === 'string') {
                  refetchReactionsDebouncedRef.current?.(messageId)
                }
                break
              }
              case 'read_state': {
                // Another tab / device of the same user marked a channel
                // as read; clear local unread + mention counts.
                if (payload.user_id !== meRef.current?.id) break
                const cid = payload.channel_id
                if (typeof cid !== 'string') break
                setChannels(current =>
                  current.map(c =>
                    c.id === cid
                      ? { ...c, unread_count: 0, mention_count: 0 }
                      : c
                  )
                )
                break
              }
              case 'channel_update': {
                // `channel_update` is an envelope with an opaque `payload`
                // (`payload: unknown` on the PubSubEvent). Read-receipt fan-out
                // (`POST /api/messages/:id/read`) rides inside it — merge the
                // reader into the matching post's stack so avatars update live.
                const action = routeChannelUpdate(payload.payload)
                if (action.kind === 'read_receipt') {
                  const ev = action.event
                  setPosts(current => applyReadReceiptEvent(current, ev))
                } else {
                  // Genuine channel-metadata change; refetch the channel list to
                  // stay authoritative. Debounced so a burst of admin edits
                  // collapses into a single refetch.
                  refetchChannelsDebouncedRef.current?.()
                }
                break
              }
              case 'typing': {
                const t = payload
                if (t.type === 'typing' && realtimeBus) {
                  realtimeBus.publishTyping({
                    channelId: t.channel_id,
                    userId: t.user_id,
                    active: t.active,
                  })
                }
                break
              }
              case 'presence': {
                const p = payload
                if (p.type === 'presence' && realtimeBus) {
                  realtimeBus.publishPresence({
                    userId: p.user_id,
                    lastSeen: p.last_seen,
                    status: p.status as 'online' | 'away' | 'dnd' | 'offline',
                  })
                }
                break
              }
              default:
                break
            }
          },
        })
        // Presence heartbeats fan out on the workspace presence topic, not the
        // per-channel topic, so the channel subscribe alone never delivers them.
        // Subscribe to THIS workspace's presence topic so `case 'presence'` fires
        // and presence dots go live — without receiving other workspaces' presence.
        // Mirrors `presenceTopic(workspaceId)` in `lib/realtime/redisPubSub.ts`
        // (inlined to keep the server-only pub/sub module out of the client bundle).
        if (activeTeamId) handle.subscribeTopic(`presence:${activeTeamId}`)
        return () => handle.close()
      }
      // SSE / polling fallback.
      return connectCollab(
        channel.id,
        () => sinceMsRef.current,
        onIncoming,
        undefined,
        onDeletions,
        up => { if (!cancelled) setStreamUp(up) },
        onReadReceipts
      )
    })()

    return () => { cancelled = true; stop() }
  }, [channel, activeTeamId, bumpSinceFromPosts, scrollToBottom])

  // ── Message actions ─────────────────────────────────────────────────────
  const onReactionsUpdated = useCallback((messageId: string, reactions: ReactionSummary[]) => {
    setPosts(cur => cur.map(p => p.id === messageId ? { ...p, reactions } : p))
  }, [])

  // ── Wire up the WS-event debouncers. The realtime hook reads these
  //    through `*Ref` so its dep-array stays minimal; the actual functions
  //    capture `activeTeamId` and the latest setters by reference. ──────
  useEffect(() => {
    const reactionTimers = new Map<string, ReturnType<typeof setTimeout>>()
    const reactionDebounce = (messageId: string) => {
      const existing = reactionTimers.get(messageId)
      if (existing) clearTimeout(existing)
      reactionTimers.set(messageId, setTimeout(() => {
        reactionTimers.delete(messageId)
        void (async () => {
          try {
            const r = await apiFetch(`/api/messages/${encodeURIComponent(messageId)}`, { method: 'GET' })
            if (!r.ok) return
            const data = (await r.json()) as { reactions?: ReactionSummary[] }
            onReactionsUpdated(messageId, data.reactions ?? [])
          } catch { /* swallow — refetch is best-effort */ }
        })()
      }, 200))
    }

    let channelsTimer: ReturnType<typeof setTimeout> | null = null
    const channelsDebounce = () => {
      if (channelsTimer) clearTimeout(channelsTimer)
      channelsTimer = setTimeout(() => {
        channelsTimer = null
        if (!activeTeamId) return
        void (async () => {
          try {
            const r = await apiFetch(`/api/channels?workspace_id=${encodeURIComponent(activeTeamId)}`, { method: 'GET' })
            if (!r.ok) return
            const data = (await r.json()) as { channels?: Channel[] }
            if (Array.isArray(data.channels)) setChannels(data.channels)
          } catch { /* swallow — refetch is best-effort */ }
        })()
      }, 300)
    }

    refetchReactionsDebouncedRef.current = reactionDebounce
    refetchChannelsDebouncedRef.current = channelsDebounce

    return () => {
      for (const t of reactionTimers.values()) clearTimeout(t)
      reactionTimers.clear()
      if (channelsTimer) clearTimeout(channelsTimer)
      refetchReactionsDebouncedRef.current = null
      refetchChannelsDebouncedRef.current = null
    }
  }, [activeTeamId, onReactionsUpdated])

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

  // ── Message right-click context menu (Slice 4) ──────────────────────────
  // Stable handler exposed to the message rows. Positions a portal menu at the
  // cursor; action callbacks reuse the existing message handlers above.
  const handleMessageContextMenu = useCallback((e: React.MouseEvent, postId: string) => {
    e.preventDefault()
    setMsgContextMenu({ x: e.clientX, y: e.clientY, postId })
  }, [])

  const ctxCopyText = useCallback((postId: string) => {
    const post = posts.find(p => p.id === postId)
    if (!post) return
    const plain = post.message.replace(/<[^>]+>/g, '')
    navigator.clipboard.writeText(plain).catch(() => {})
  }, [posts])

  const ctxAddReaction = useCallback((postId: string) => {
    const row = document.querySelector(`[data-message-id="${CSS.escape(postId)}"]`)
    // Prefer the stable test id; fall back to the aria-label for resilience.
    const btn = row?.querySelector('[data-testid="message-reaction-button"]')
      || row?.querySelector('[aria-label="Add reaction"]')
    if (btn instanceof HTMLElement) btn.click()
  }, [])

  const ctxReplyInThread = useCallback((postId: string) => {
    const post = posts.find(p => p.id === postId)
    if (post) setThreadRoot(post)
  }, [posts])

  const ctxPin = useCallback((postId: string) => {
    const post = posts.find(p => p.id === postId)
    if (post) void handlePinMessage(post)
  }, [posts, handlePinMessage])

  const ctxDelete = useCallback((postId: string) => {
    const post = posts.find(p => p.id === postId)
    if (post) void handleDeleteMessage(post)
  }, [posts, handleDeleteMessage])

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

  // ── Create DM or Group DM ───────────────────────────────────────────────
  const startChat = useCallback(async (peerIds: string[]) => {
    if (!activeTeamId || peerIds.length === 0) return
    const body: { workspace_id: string; type: string; peer_user_id?: string; peer_user_ids?: string[] } = { workspace_id: activeTeamId, type: 'D' }
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

  // ── Per-workspace unread/mention rollups for the rail badges (Wave2 Slice3) ──
  // Channels for the active workspace live in `channels`; cross-workspace
  // totals are only available for the active team, so badges show on the
  // active icon when its channels carry unread/mention counts.
  const workspaceBadges = useMemo(() => {
    const map = new Map<string, { unread: number; mention: number }>()
    for (const c of channels) {
      if (!c.team_id) continue
      const cur = map.get(c.team_id) || { unread: 0, mention: 0 }
      cur.unread += c.unread_count ?? 0
      cur.mention += c.mention_count ?? 0
      map.set(c.team_id, cur)
    }
    return map
  }, [channels])

  // ── Quick switcher actions (formerly the CommandPalette items) ────────
  const quickActions: QuickSwitchAction[] = useMemo(() => {
    const list: QuickSwitchAction[] = [
      { id: 'nav-tickets', group: 'Modules', label: 'Tickets', icon: <Ticket size={14} />, run: () => router.push('/tickets') },
      { id: 'nav-tickets-new', group: 'Tickets', label: 'Create ticket', hint: 'Open ticket composer', icon: <Plus size={14} />, keywords: ['new', 'create'], run: () => router.push('/tickets?new=1') },
      { id: 'nav-tickets-mine', group: 'Tickets', label: 'My tickets', icon: <Ticket size={14} />, keywords: ['assigned', 'open'], run: () => router.push('/tickets?assignee=me') },
      { id: 'nav-tickets-sla', group: 'Tickets', label: 'SLA breaches', icon: <Ticket size={14} />, keywords: ['overdue', 'breached'], run: () => router.push('/tickets?sla=breached') },
      { id: 'nav-documents', group: 'Modules', label: 'Documents', icon: <FileText size={14} />, run: () => router.push('/documents') },
      { id: 'nav-documents-new', group: 'Documents', label: 'New document from template', hint: 'Puzzle Box assembly', icon: <Plus size={14} />, keywords: ['template', 'pdf', 'assemble', 'puzzle'], run: () => router.push('/documents?new=1') },
      { id: 'nav-documents-templates', group: 'Documents', label: 'Manage templates', icon: <FileText size={14} />, keywords: ['template'], run: () => router.push('/documents?tab=templates') },
      { id: 'nav-settings', group: 'Account', label: 'Preferences', icon: <Settings size={14} />, keywords: ['settings'], run: () => setPreferencesModalOpen(true) },
      { id: 'nav-marketplace', group: 'Modules', label: 'Plugin Marketplace', icon: <Package size={14} />, run: () => router.push(`/home?team=${encodeURIComponent(activeTeamId)}&module=marketplace`) },
      { id: 'nav-workspaces', group: 'Account', label: 'All Workspaces', icon: <LayoutGrid size={14} />, run: () => router.push('/workspaces') },
      { id: 'nav-shortcuts', group: 'Account', label: 'Keyboard shortcuts', hint: 'Open quick reference', icon: <Keyboard size={14} />, keywords: ['help'], run: () => setShortcutsOpen(true) },
      { id: 'nav-call-history', group: 'Modules', label: 'Call history', icon: <Phone size={14} />, keywords: ['calls', 'past calls', 'huddle history', 'video'], run: () => router.push(`/home?team=${encodeURIComponent(activeTeamId)}&module=calls`) },
    ]
    if (me && isPlatformAdmin(me.platform_role)) {
      list.push({ id: 'nav-admin', group: 'Account', label: 'Admin Panel', icon: <Shield size={14} />, run: () => router.push('/admin') })
    }
    return list
  }, [me, router, activeTeamId])

  // ── Load starred channels from localStorage ─────────────────────────────
  useEffect(() => {
    setStarredIds(readStarredChannels())
    setDraftIds(new Set(getChannelIdsWithDrafts()))
  }, [])

  const handleToggleStar = useCallback(async (channelId: string) => {
    await toggleStarChannel(channelId)
    setStarredIds(readStarredChannels())
  }, [])

  // ── Custom sidebar sections (audit §1.3) ──────────────────────────────
  const [channelCategories, setChannelCategories] = useState<ChannelCategoryRow[]>([])
  const reloadCategories = useCallback(() => {
    void (async () => {
      const rows = await loadChannelCategories()
      setChannelCategories(rows)
    })()
  }, [])
  useEffect(() => { reloadCategories() }, [reloadCategories])

  const handleMoveChannelToSection = useCallback(async (channelId: string, sectionName: string) => {
    const key = sectionKey(sectionName)
    if (!key) return
    const ok = await moveChannelToSection(channelId, key)
    if (ok) reloadCategories()
  }, [reloadCategories])

  const handleRemoveChannelFromSection = useCallback(async (channelId: string) => {
    const ok = await removeChannelFromSection(channelId)
    if (ok) reloadCategories()
  }, [reloadCategories])

  // Refresh draft indicators when channel changes
  useEffect(() => {
    setDraftIds(new Set(getChannelIdsWithDrafts()))
  }, [channel?.id])

  // ── Slack-style J/K/R/T/E message keyboard navigation ──────────────────
  const msgKeyNavActions = useMemo(() => ({
    onOpenThread: setThreadRoot,
    onEditMessage: handleEditMessage,
  }), [handleEditMessage])
  const { focusedMessageId, clearFocus: clearMsgFocus } = useMessageKeyNav(
    posts, me?.id, timelineRef, msgKeyNavActions, channel?.id ?? null
  )

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
        toggleChannelInfo()
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault()
        setChannelsOpen(v => !v)
      }
      // Cmd/Ctrl + , → open Preferences (Slack standard)
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        setPreferencesModalOpen(v => !v)
      }
      // Cmd/Ctrl + 1..9 → switch to the Nth workspace (audit §1.1 — Slack-standard)
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key, 10) - 1
        const targetTeam = teams[idx]
        if (targetTeam && targetTeam.id !== activeTeamId) {
          e.preventDefault()
          sessionStorage.setItem(TEAM_KEY, targetTeam.id)
          router.push(`/home?team=${encodeURIComponent(targetTeam.id)}`)
          return
        }
        // If user has only one workspace, fall through to channel navigation.
        if (teams.length <= 1) {
          e.preventDefault()
          const target = channels[idx]
          if (target) setChannel(target)
        }
      }
      // Cmd/Ctrl + Shift + H → toggle huddle (§13.2)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault()
        const params = new URLSearchParams({ team: activeTeamId })
        const currentModule = new URLSearchParams(window.location.search).get('module')
        if (currentModule === 'huddle') {
          router.push(`/home?${params.toString()}`)
        } else {
          params.set('module', 'huddle')
          router.push(`/home?${params.toString()}`)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [channels, teams, activeTeamId, router, toggleChannelInfo])

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

  // ── Escape: close workspace menu ──────────────────────────────────────
  useEffect(() => {
    if (!wsMenuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWsMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [wsMenuOpen])

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
    <main
      className={`app-shell${teams.length > 1 ? ' app-shell--has-rail' : ''}${channelsOpen ? ' app-shell--channels-open' : ''}`}
      style={initialSidebarWidth != null ? { '--sidebar-track': `${initialSidebarWidth}px` } as React.CSSProperties : undefined}
    >
      {/* ── Toast notifications (mounted once at app root, Slice 1/4) ── */}
      <ToastProvider />
      {/* ── Workspace rail ──────────────────────────────────────── */}
      {teams.length > 1 && (
        <aside className="workspace-rail" aria-label="Workspaces">
          {teams.map((t, idx) => {
            const cmdHint = idx < 9 ? `  ⌘${idx + 1}` : ''
            const badge = workspaceBadges.get(t.id)
            const mentionTotal = badge?.mention ?? 0
            const unreadTotal = badge?.unread ?? 0
            const showBadge = mentionTotal > 0 || unreadTotal > 0
            return (
              <Link key={t.id} href={`/home?team=${encodeURIComponent(t.id)}`}
                className={`workspace-icon${t.id === activeTeamId ? ' active' : ''}`}
                title={`${t.display_name}${cmdHint}`}
                onClick={() => sessionStorage.setItem(TEAM_KEY, t.id)}>
                {(t.display_name || t.name).slice(0, 1).toUpperCase()}
                {showBadge && (
                  mentionTotal > 0 ? (
                    <span
                      aria-label={`${mentionTotal} mentions`}
                      style={{
                        position: 'absolute', top: -3, right: -3,
                        minWidth: 16, height: 16, padding: '0 4px',
                        borderRadius: 9, background: '#1264a3', color: '#fff',
                        fontSize: 10, fontWeight: 700, lineHeight: '16px',
                        textAlign: 'center', boxShadow: '0 0 0 2px rgba(0,0,0,0.45)',
                        pointerEvents: 'none',
                      }}>
                      {mentionTotal > 99 ? '99+' : mentionTotal}
                    </span>
                  ) : (
                    <span
                      aria-label={`${unreadTotal} unread`}
                      style={{
                        position: 'absolute', top: 0, right: 0,
                        width: 10, height: 10, borderRadius: '50%',
                        background: '#fff', boxShadow: '0 0 0 2px rgba(0,0,0,0.45)',
                        pointerEvents: 'none',
                      }}
                    />
                  )
                )}
              </Link>
            )
          })}
          <div className="rail-dot" />
          <Link className="workspace-icon small" href="/workspaces" title="All workspaces">+</Link>
        </aside>
      )}

      {/* ── Channel sidebar ─────────────────────────────────────── */}
      <aside
        id="app-shell-channel-list"
        className="channel-list"
        aria-label="Channels and modules"
        style={initialSidebarWidth != null ? { width: `${initialSidebarWidth}px`, maxWidth: `${initialSidebarWidth}px` } : undefined}
      >
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
          <WorkspaceDropdown
            open={wsMenuOpen}
            onClose={() => setWsMenuOpen(false)}
            workspaceId={activeTeamId}
            workspaceName={activeTeam?.display_name || ''}
            workspaceSlug={activeTeam?.name || ''}
            me={me}
            onInvite={(url, busy) => { setInviteUrl(url); setInviteBusy(busy); if (busy) setInviteModalOpen(true) }}
            onOpenPreferences={() => setPreferencesModalOpen(true)}
            onOpenSidebarCustomizer={() => setSidebarCustomizerOpen(true)}
            onOpenShortcuts={() => setShortcutsOpen(true)}
            onOpenEmojiPanel={() => setEmojiPanelOpen(true)}
          />
        </header>

        <ChannelSidebar
          channels={channels}
          channel={channel}
          activeModule={activeModule}
          activeTeamId={activeTeamId}
          starredIds={starredIds}
          draftIds={draftIds}
          me={me}
          teamMembers={teamMembers}
          dmPreview={dmPreview}
          getStatus={getStatus}
          onSelectChannel={(ch) => { setChannel(ch); setChannelsOpen(false); router.push(`/home?team=${encodeURIComponent(activeTeamId)}`) }}
          onNavigateModule={(mod) => { setChannelsOpen(false); setMoreMenuOpen(() => false); router.push(mod === 'home' ? `/home?team=${encodeURIComponent(activeTeamId)}` : `/home?team=${encodeURIComponent(activeTeamId)}&module=${mod}`) }}
          onToggleStar={handleToggleStar}
          onNewChannel={() => setNewChannelOpen(true)}
          onNewMessage={() => setNewMessageOpen(true)}
          onBrowseChannels={() => setChannelBrowseOpen(true)}
          onOpenDm={(uid) => void openDm(uid)}
          onCmdPalette={() => setQuickSwitcherOpen(true)}
          onLeaveChannel={(chId) => setLeaveConfirmChannelId(chId)}
          onOpenChannelInfo={(chId) => {
            const ch = channels.find(c => c.id === chId)
            if (ch) {
              setChannel(ch)
              // Group-exclusive: evict the other secondary panes, keep thread.
              setPinnedPanelOpen(false)
              setMemberListOpen(false)
              setProfilePaneId(null)
              setChannelInfoOpen(true)
              router.push(`/home?team=${encodeURIComponent(activeTeamId)}`)
            }
          }}
          channelCategories={channelCategories}
          onMoveChannelToSection={handleMoveChannelToSection}
          onRemoveChannelFromSection={handleRemoveChannelFromSection}
          moreMenuOpen={moreMenuOpen}
          setMoreMenuOpen={setMoreMenuOpen}
        />

        {/* ── User profile footer (Slack-style) ────────────────── */}
        <UserFooter
          me={me}
          presenceStatus={getStatus(me?.id || '')}
          displayName={me ? displayName(me) : 'Loading...'}
          onOpenPreferences={() => setPreferencesModalOpen(true)}
          onOpenCustomStatus={() => setCustomStatusOpen(true)}
        />
      </aside>

      {/* ── Main pane ───────────────────────────────────────────── */}
      {activeModule ? (
        <ModuleRenderer
          activeModule={activeModule}
          activeTeamId={activeTeamId}
          channelTitle={channelTitle}
          channelsOpen={channelsOpen}
          setChannelsOpen={setChannelsOpen}
          me={me}
          channels={channels}
          openDm={openDm}
          navigateHome={() => router.push(`/home?team=${encodeURIComponent(activeTeamId)}`)}
          navigateToChannel={(chId, msgId) => {
            const ch = channels.find(c => c.id === chId)
            if (ch) {
              const qs = `team=${encodeURIComponent(activeTeamId)}&channel=${encodeURIComponent(ch.name)}${msgId ? `&focus_msg=${encodeURIComponent(msgId)}` : ''}`
              router.push(`/home?${qs}`)
            }
          }}
          navigateToThread={(chId, rootId) => {
            const ch = channels.find(c => c.id === chId)
            if (ch) router.push(`/home?team=${encodeURIComponent(activeTeamId)}&channel=${encodeURIComponent(ch.name)}&thread=${encodeURIComponent(rootId)}`)
          }}
        />
      ) : (
        <>
        <section className="chat-pane"
          onDragEnter={(e) => { e.preventDefault(); pageDragCounter.current++; if (e.dataTransfer.types.includes('Files')) setPageDragOver(true) }}
          onDragLeave={(e) => { e.preventDefault(); pageDragCounter.current--; if (pageDragCounter.current <= 0) { setPageDragOver(false); pageDragCounter.current = 0 } }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault(); setPageDragOver(false); pageDragCounter.current = 0
            const files = e.dataTransfer.files
            if (files.length > 0 && composerRef.current) {
              // Focus composer and trigger file upload via the composer's hidden input
              composerRef.current.focus()
              // We'll pass files to the composer's upload mechanism
              for (let i = 0; i < files.length; i++) {
                const form = new FormData()
                form.append('workspace_id', activeTeamId || '')
                form.append('file', files[i], files[i].name)
                void apiFetch('/api/documents', { method: 'POST', body: form })
              }
            }
          }}
        >
        {pageDragOver && (
          <div className="page-drag-overlay">
            <div className="page-drag-overlay-content">
              <Paperclip size={32} />
              <h3>Drop files to upload</h3>
              <p>Files will be uploaded to #{channelTitle}</p>
            </div>
          </div>
        )}
        <UpdateBanner />
        <NotificationPermissionBanner />
        <ChatHeader
          channel={channel}
          channelTitle={channelTitle}
          channelsOpen={channelsOpen}
          setChannelsOpen={setChannelsOpen}
          starredIds={starredIds}
          onToggleStar={handleToggleStar}
          onLeaveChannel={(chId) => setLeaveConfirmChannelId(chId)}
          onInviteToChannel={() => setInviteModalOpen(true)}
          onTopicSaved={(chId, newTopic) => setChannels(prev => prev.map(c => c.id === chId ? { ...c, purpose: newTopic } : c))}
          searchOpen={searchOpen}
          onSearchOpen={() => setSearchOpen(true)}
          channelInfoOpen={channelInfoOpen}
          onToggleChannelInfo={toggleChannelInfo}
          pinnedPanelOpen={pinnedPanelOpen}
          onTogglePinnedPanel={togglePinnedPanel}
          memberListOpen={memberListOpen}
          onToggleMemberList={toggleMemberList}
          memberCount={teamMembers.length}
          streamUp={streamUp}
          meExists={Boolean(me)}
          onOpenChannelNotifPrefs={() => setChannelNotifPrefsOpen(true)}
          onOpenFiles={toggleFilesPane}
          filesPanelOpen={filesPaneOpen}
        />

        {/* ── Bookmark bar (Slack-style channel bookmarks) ──── */}
        {channel && <BookmarkBar channelId={channel.id} channelType={channel.type} />}

        <div className="message-timeline aae-timeline" ref={timelineRef} style={{ position: 'relative' }}>
          {/* Phase A — Jump-to-date pill (Blueprint Part 3.2). Shows the
              currently-visible day; clicking opens a native date picker that
              scrolls the timeline to the chosen day. */}
          {posts.length > 0 && (
            <JumpToDate
              currentLabel={(() => {
                const top = visiblePosts[0]
                if (!top) return ''
                const d = new Date(top.create_at)
                const now = new Date()
                const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
                const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
                const diff = today.getTime() - msgDay.getTime()
                if (diff === 0) return 'Today'
                if (diff === 86400000) return 'Yesterday'
                return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
              })()}
              onPickDate={(yyyyMmDd) => {
                // Find the first message on or after the picked date and scroll to it.
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

              {/* CTA cards (audit §3.5) — channels only */}
              {channel && channel.type !== 'D' && (
                <div style={{ marginTop: 28, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, maxWidth: 640 }}>
                  <button
                    type="button"
                    className="ghost-button"
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left', padding: '14px 16px', gap: 4 }}
                    onClick={openChannelInfo}
                  >
                    <strong style={{ fontSize: 13 }}>Add a description</strong>
                    <span style={{ fontSize: 12, opacity: 0.7 }}>Tell members what this channel is for.</span>
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left', padding: '14px 16px', gap: 4 }}
                    onClick={() => setInviteModalOpen(true)}
                  >
                    <strong style={{ fontSize: 13 }}>Add members</strong>
                    <span style={{ fontSize: 12, opacity: 0.7 }}>Invite teammates to join the conversation.</span>
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left', padding: '14px 16px', gap: 4 }}
                    onClick={openChannelInfo}
                  >
                    <strong style={{ fontSize: 13 }}>Set channel topic</strong>
                    <span style={{ fontSize: 12, opacity: 0.7 }}>Add a one-line summary of what's happening.</span>
                  </button>
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
              <div key={post.id} className="message-group-wrapper"
                onContextMenu={(e) => { if (!isSystemPost(post)) handleMessageContextMenu(e, post.id) }}>
                {unreadSepId === post.id && (
                  <div className="unread-separator" onClick={() => setUnreadSepId(null)} role="button" tabIndex={0} aria-label="Clear new messages marker">
                    <span className="unread-separator-text">New messages</span>
                  </div>
                )}
                {showDateDivider && (
                  <DateSeparator
                    label={(() => {
                      const d = new Date(post.create_at)
                      const now = new Date()
                      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
                      const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
                      const diff = today.getTime() - msgDay.getTime()
                      if (diff === 0) return 'Today'
                      if (diff === 86400000) return 'Yesterday'
                      return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined })
                    })()}
                  />
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
                ) : isSystemPost(post) ? (
                  <SystemMessage post={post} userMap={userMap} />
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
                    onAvatarClick={uid => openProfilePane(uid)}
                    onMentionClick={username => {
                      // Resolve @username to userId and open profile pane
                      const found = Object.values(userMap).find(u => u.username === username)
                      if (found) openProfilePane(found.id)
                    }}
                    onConvertToTicket={async (p) => {
                      try {
                        const res = await apiFetch('/api/tickets/from-message', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            message_id: p.id,
                            channel_id: p.channel_id,
                            workspace_id: activeTeamId,
                            title: p.message.replace(/<[^>]+>/g, '').slice(0, 120) || 'Chat message ticket',
                            description: p.message,
                          })
                        })
                        if (res.ok) {
                          const data = await res.json() as { ticket?: { id: string } }
                          if (data.ticket?.id) {
                            router.push(`/home?team=${encodeURIComponent(activeTeamId)}&module=tickets&ticket=${encodeURIComponent(data.ticket.id)}`)
                          }
                        }
                      } catch { /* silently fail */ }
                    }}
                    onReactionsUpdated={onReactionsUpdated} 
                  />
                )}
              </div>
            )
          })}

          {channel ? (
            <TypingIndicator channelId={channel.id} userMap={userMap} myId={me?.id || ''} bus={realtimeBus} />
          ) : null}
        </div>

        {/* ── Jump to bottom floating button ────────────────────── */}
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
          teamMembers={teamMembers} onSend={msg => void handleSend(msg)}
          onDraftChange={emitTyping}
          onRecordAudio={() => setClipRecorder({ mode: 'audio' })}
          onRecordVideo={() => setClipRecorder({ mode: 'video' })} />
      </section>

      {/* ── Thread pane ─────────────────────────────────────────── */}
      {threadRoot && (
        <ThreadPanel rootPost={threadRoot} channelTitle={channelTitle}
          channelType={channel?.type} me={me} userMap={userMap}
          teamMembers={teamMembers} onClose={() => setThreadRoot(null)}
          onResolveUsers={resolveUsers} />
      )}

      {/* ── Member list panel (right sidebar) ─────────────────── */}
      <MemberListPanel
        open={memberListOpen}
        members={teamMembers}
        getStatus={getStatus}
        displayName={displayName}
        onOpenDm={(uid) => void openDm(uid)}
        onClose={() => setMemberListOpen(false)}
        channelId={channel?.id}
        candidates={teamMembers}
        onAdded={() => void loadTeamMembers()}
      />

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

      {/* ── Files browser panel (right sidebar) ───────────────── */}
      {filesPaneOpen && (
        <aside className="file-browser-pane" role="complementary" aria-label="Channel files">
          <FileBrowserPanel
            workspaceId={activeTeamId}
            channelId={channel?.id}
            onClose={() => setFilesPaneOpen(false)}
          />
        </aside>
      )}
      </>
      )}

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
      {emojiPanelOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2500, background: 'rgba(0,0,0,0.5)', display: 'grid', placeItems: 'center' }} onClick={() => setEmojiPanelOpen(false)}>
          <div onClick={e => e.stopPropagation()} style={{ width: 600, maxHeight: '80vh', borderRadius: 16, overflow: 'hidden' }}>
            <CustomEmojiPanel onClose={() => setEmojiPanelOpen(false)} />
          </div>
        </div>
      )}

      {/* ── Leave channel confirmation ─────────────────────────── */}
      <ConfirmDialog
        open={!!leaveConfirmChannelId}
        title="Leave channel?"
        message={<>Are you sure you want to leave <strong>{channels.find(c => c.id === leaveConfirmChannelId)?.display_name || 'this channel'}</strong>? You can rejoin it later from the channel browser.</>}
        confirmLabel="Leave Channel"
        danger
        onCancel={() => setLeaveConfirmChannelId(null)}
        onConfirm={async () => {
          const chId = leaveConfirmChannelId!
          setLeaveConfirmChannelId(null)
          await apiFetch(`/api/channel-members?channel_id=${encodeURIComponent(chId)}&user_id=me`, { method: 'DELETE' })
          setChannels(prev => prev.filter(c => c.id !== chId))
          if (channel?.id === chId) setChannel(null)
        }}
      />

      {/* ── Create channel modal ────────────────────────────────── */}
      <CreateChannelModal
        open={newChannelOpen}
        workspaceId={activeTeamId}
        onClose={() => setNewChannelOpen(false)}
        onCreated={(ch) => { loadChannels(); setChannel(ch as Channel) }}
      />

      {/* ── Delete message confirmation modal ───────────────────── */}
      <ConfirmDialog
        open={!!pendingDeleteMsg}
        title="Delete message?"
        message="Are you sure you want to delete this message? This action cannot be undone."
        confirmLabel="Delete"
        danger
        onCancel={() => setPendingDeleteMsg(null)}
        onConfirm={() => void performDeleteMsg()}
      />

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
        onOpenProfile={uid => openProfilePane(uid)}
      />

      {/* ── Quick Switcher (Cmd+K) ────────────────────────────── */}
      <QuickSwitcher
        open={quickSwitcherOpen}
        onClose={() => setQuickSwitcherOpen(false)}
        channels={channels}
        teamMembers={teamMembers}
        actions={quickActions}
        workspaceId={activeTeamId}
        currentChannelId={channel?.id}
        onSelectChannel={ch => { setChannel(ch); setChannelsOpen(false) }}
        onSelectDm={uid => void openDm(uid)}
      />

      {/* ── User profile rail pane (audit §9.2) ───────────────── */}
      {profilePaneId && (
        <UserProfilePanel
          userId={profilePaneId}
          currentUserId={me?.id}
          presenceStatus={getStatus(profilePaneId)}
          onClose={() => setProfilePaneId(null)}
          onMessage={(uid) => { void openDm(uid); setProfilePaneId(null) }}
          onHuddle={(uid) => {
            void openDm(uid)
            router.push(`/home?team=${encodeURIComponent(activeTeamId)}&module=huddle`)
          }}
        />
      )}

      {/* ── User hovercard (300ms hover on @mentions, audit §9.1) ── */}
      <UserHovercard
        userMap={userMap}
        getStatus={getStatus}
        onStartDm={uid => void openDm(uid)}
        onOpenFullProfile={uid => openProfilePane(uid)}
      />

      {newMessageOpen && (
        <NewMessageModal
          open={newMessageOpen}
          onClose={() => setNewMessageOpen(false)}
          users={teamMembers}
          meId={me?.id || ''}
          onStartChat={startChat}
        />
      )}

      {/* ── Preferences Modal (new architecture) ──────────── */}
      {preferencesModalOpen && (
        <PreferencesModal onClose={() => setPreferencesModalOpen(false)} />
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
      <CustomStatusPopup open={customStatusOpen} onClose={() => setCustomStatusOpen(false)} />

      {/* ── Invite Members Modal (Slack-style) ─────────────── */}
      <InviteModal
        open={inviteModalOpen}
        workspaceName={activeTeam?.display_name || 'workspace'}
        inviteUrl={inviteUrl}
        inviteBusy={inviteBusy}
        onClose={() => setInviteModalOpen(false)}
      />

      {/* ── Sidebar Customizer (Slack-style) ───────────────── */}
      <SidebarCustomizer
        open={sidebarCustomizerOpen}
        sections={sidebarSections}
        onSectionsChange={setSidebarSections}
        onClose={() => setSidebarCustomizerOpen(false)}
      />

      {/* ── Audio/Video Clip Recorder overlay (Slack Clips) ───── */}
      {clipRecorder && (
        <div className="modal-overlay" role="presentation" onClick={() => setClipRecorder(null)}>
          <div onClick={e => e.stopPropagation()}>
            <AudioVideoClipRecorder
              mode={clipRecorder.mode}
              onClose={() => setClipRecorder(null)}
              onSend={(clip) => {
                // Upload the recorded clip as a real media attachment via the
                // same /api/documents path drag-and-drop uploads use.
                const ext = clip.blob.type.includes('mp4') ? 'mp4' : 'webm'
                const form = new FormData()
                form.append('workspace_id', activeTeamId || '')
                form.append('file', clip.blob, `clip-${clip.type}.${ext}`)
                void apiFetch('/api/documents', { method: 'POST', body: form })
                setClipRecorder(null)
              }}
            />
          </div>
        </div>
      )}

      {/* ── Message right-click context menu (Slice 4) ──────────── */}
      <MessageContextMenu
        menu={msgContextMenu}
        onClose={() => setMsgContextMenu(null)}
        onCopyText={ctxCopyText}
        onAddReaction={ctxAddReaction}
        onReplyInThread={ctxReplyInThread}
        onPin={ctxPin}
        onDelete={ctxDelete}
      />
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
