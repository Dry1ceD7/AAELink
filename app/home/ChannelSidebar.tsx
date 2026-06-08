'use client'

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { ChevronDown, Plus, Hash, Lock, Star, Search, PenLine, BellOff, X } from 'lucide-react'
import { displayName, type AppUser } from '@/components/chat/ChatMessage'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { TOP_NAV_ITEMS, MORE_NAV_ITEMS, MORE_MODULE_KEYS, ENTERPRISE_NAV_ITEMS, ADMIN_NAV_ITEMS, MORE_ICON } from './sidebarNav'
import { ChannelContextMenu, type ChannelContextMenuTarget } from './ChannelContextMenu'
import { ManageSidebarMenu } from './ManageSidebarMenu'
import { readMutedChannels, syncMutedChannels } from '@/lib/channels/channelMute'
import {
  DEFAULT_SIDEBAR_ORDER,
  moveSlot,
  persistSidebarOrder,
  readSidebarOrder,
  type SidebarSlotId,
} from '@/lib/channels/sidebarOrder'
import {
  groupChannelsBySection,
  sectionKey,
  sectionLabel,
  readManageSidebarPrefs,
  type ChannelCategoryRow,
  type ManageSidebarPrefs,
} from '@/lib/channels/sidebarSections'

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

/* Sidebar drag-resize bounds + persistence key (Slack-style resizable rail). */
const SIDEBAR_WIDTH_KEY = 'sidebar_width'
const SIDEBAR_MIN_WIDTH = 180
const SIDEBAR_MAX_WIDTH = 420
/* Below this viewport width the rail becomes a fixed overlay; resizing is disabled. */
const SIDEBAR_RESIZE_BREAKPOINT = 920

function clampSidebarWidth(px: number): number {
  if (!Number.isFinite(px)) return SIDEBAR_MIN_WIDTH
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(px)))
}

export function readSidebarWidth(): number | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY)
    if (!raw) return null
    const px = Number.parseInt(raw, 10)
    return Number.isFinite(px) ? clampSidebarWidth(px) : null
  } catch {
    return null
  }
}

/* The visible label used for client-side quick filtering. */
function channelFilterLabel(c: Channel): string {
  return (c.dm_peer_display || c.display_name || c.name || '').toLowerCase()
}

/* ── Per-section channel-row ordering (drag-reorder within a section) ──
   Persisted to localStorage with the same shape the file uses for section
   collapse (`sidebar_section_<id>`): one key per section, key
   `sidebar_order_<section>` holding a JSON array of channel ids in the
   user's chosen order. Unknown / removed ids are ignored on apply; channels
   missing from the saved order keep their server order, appended after the
   saved ones, so new channels surface without clobbering the saved layout. */
function rowOrderKey(section: string): string {
  return `sidebar_order_${section}`
}

function readRowOrder(section: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(rowOrderKey(section))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function persistRowOrder(section: string, ids: string[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(rowOrderKey(section), JSON.stringify(ids))
  } catch {
    /* quota exceeded */
  }
}

/* Apply a saved id ordering to a channel list: saved ids first (in saved
   order, skipping any no longer present), then any remaining channels in
   their original order. Pure — does not mutate the input. */
function applyRowOrder<T extends { id: string }>(list: T[], savedIds: string[]): T[] {
  if (savedIds.length === 0) return list
  const byId = new Map(list.map(c => [c.id, c]))
  const ordered: T[] = []
  const used = new Set<string>()
  for (const id of savedIds) {
    const item = byId.get(id)
    if (item && !used.has(id)) { ordered.push(item); used.add(id) }
  }
  for (const item of list) {
    if (!used.has(item.id)) ordered.push(item)
  }
  return ordered
}

/* Compute the reordered id list when dropping `dragId` onto `overId`.
   Removing the dragged id before re-inserting shifts every index after it down
   by one, so when the drag source sits before the drop target the target index
   must be decremented to land the item at the visually-intended slot. */
function reorderIds(ids: string[], dragId: string, overId: string): string[] {
  if (dragId === overId) return ids
  const from = ids.indexOf(dragId)
  const to = ids.indexOf(overId)
  if (from < 0 || to < 0) return ids
  const next = [...ids]
  next.splice(from, 1)
  const insertAt = from < to ? to - 1 : to
  next.splice(insertAt, 0, dragId)
  return next
}

/* ── Collapsible sidebar section (Slack-style <details>) ──────── */
function SidebarSection({
  id, title, children, onAdd,
  draggable, onDragStart, onDragEnd, onDragOver, onDrop, isDragOver,
}: {
  id: string
  title: string
  children: React.ReactNode
  onAdd?: () => void
  draggable?: boolean
  onDragStart?: (e: React.DragEvent<HTMLDetailsElement>) => void
  onDragEnd?: (e: React.DragEvent<HTMLDetailsElement>) => void
  onDragOver?: (e: React.DragEvent<HTMLDetailsElement>) => void
  onDrop?: (e: React.DragEvent<HTMLDetailsElement>) => void
  isDragOver?: boolean
}) {
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
    <details
      className={`channel-section${isDragOver ? ' channel-section--drag-over' : ''}`}
      open={open}
      onToggle={handleToggle}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
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

export interface ChannelSidebarProps {
  channels: Channel[]
  channel: Channel | null
  activeModule: string | null
  activeTeamId: string
  starredIds: Set<string>
  draftIds: Set<string>
  me: AppUser | null
  teamMembers: AppUser[]
  dmPreview: AppUser[]
  getStatus: (userId: string) => string
  onSelectChannel: (ch: Channel) => void
  onNavigateModule: (module: string) => void
  onToggleStar: (channelId: string) => void
  onNewChannel: () => void
  onNewMessage: () => void
  onBrowseChannels: () => void
  onOpenDm: (userId: string) => void
  onCmdPalette: () => void
  onLeaveChannel?: (channelId: string) => void
  onOpenChannelInfo?: (channelId: string) => void
  /** Per-user channel→category assignments from /api/channel-categories. */
  channelCategories?: ChannelCategoryRow[]
  /** Move a channel into a custom section (creates the section on first use). */
  onMoveChannelToSection?: (channelId: string, sectionName: string) => void
  /** Remove a channel from any custom section it's in. */
  onRemoveChannelFromSection?: (channelId: string) => void
  moreMenuOpen: boolean
  setMoreMenuOpen: (fn: (v: boolean) => boolean) => void
}

export function ChannelSidebar({
  channels,
  channel,
  activeModule,
  activeTeamId,
  starredIds,
  draftIds,
  me,
  teamMembers,
  dmPreview,
  getStatus,
  onSelectChannel,
  onNavigateModule,
  onToggleStar,
  onNewChannel,
  onNewMessage,
  onBrowseChannels,
  onOpenDm,
  onCmdPalette,
  onLeaveChannel,
  onOpenChannelInfo,
  channelCategories,
  onMoveChannelToSection,
  onRemoveChannelFromSection,
  moreMenuOpen,
  setMoreMenuOpen,
}: ChannelSidebarProps) {
  // ── State ────────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<ChannelContextMenuTarget | null>(null)
  const [creatingSection, setCreatingSection] = useState<{ channelId: string } | null>(null)
  const [newSectionName, setNewSectionName] = useState('')
  const [mutedIds, setMutedIds] = useState<Set<string>>(() => readMutedChannels())
  const [manageSidebarPrefs, setManageSidebarPrefs] = useState<ManageSidebarPrefs>(() => readManageSidebarPrefs())
  const [slotOrder, setSlotOrder] = useState<readonly SidebarSlotId[]>(DEFAULT_SIDEBAR_ORDER)
  const [draggedSlot, setDraggedSlot] = useState<SidebarSlotId | null>(null)
  const [dragOverSlot, setDragOverSlot] = useState<SidebarSlotId | null>(null)

  // Per-section channel-row ordering (drag-reorder within a section).
  // `rowOrders` maps a section key (e.g. 'channels', 'dms', 'starred',
  // 'custom-<key>') to the saved id order; `rowDrag` tracks the in-flight
  // drag so we can highlight the drop target row.
  const [rowOrders, setRowOrders] = useState<Record<string, string[]>>({})
  const [rowDrag, setRowDrag] = useState<{ section: string; id: string } | null>(null)
  const [rowDragOverId, setRowDragOverId] = useState<string | null>(null)

  // Quick filter (Slack-style): filters visible channels/DMs by name client-side.
  const [quickFilter, setQuickFilter] = useState('')
  const filterQuery = quickFilter.trim().toLowerCase()

  // Resizable rail — element ref points at the <nav>; its parent is the
  // owning .channel-list <aside> (rendered by page.tsx, which we do not own).
  const rootRef = useRef<HTMLElement | null>(null)
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null)

  // Load saved slot order on mount.
  useEffect(() => {
    setSlotOrder(readSidebarOrder())
  }, [])

  // Load saved per-section channel-row orders on mount. We read every section
  // we know how to reorder; custom sections are read lazily on first render
  // via `orderedRows` (which falls back to the server order until populated).
  useEffect(() => {
    setRowOrders({
      starred: readRowOrder('starred'),
      channels: readRowOrder('channels'),
      dms: readRowOrder('dms'),
    })
  }, [])

  // Resolve the saved order for a section, reading lazily from localStorage the
  // first time a (custom) section is seen so we don't need its key up-front.
  function orderedRows<T extends { id: string }>(section: string, list: T[]): T[] {
    const saved = rowOrders[section] ?? readRowOrder(section)
    return applyRowOrder(list, saved)
  }

  // HTML5 DnD handlers for a single channel row inside `section`. `ids` is the
  // current visible id order for that section (post manage/quick filters), so
  // a drop persists exactly what the user sees.
  function rowDragHandlersFor(section: string, id: string, ids: string[]) {
    return {
      // Reordering a filtered subset would persist a partial order over the full
      // list and corrupt it — disable row drag while a quick-filter is active.
      draggable: !filterQuery,
      onDragStart: (e: React.DragEvent<HTMLButtonElement>) => {
        // Stop the event reaching the enclosing <details> slot so a row drag
        // never doubles as a section-slot drag on the same element.
        e.stopPropagation()
        setRowDrag({ section, id })
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', `row:${section}:${id}`)
      },
      onDragEnd: () => {
        setRowDrag(null)
        setRowDragOverId(null)
      },
      onDragOver: (e: React.DragEvent<HTMLButtonElement>) => {
        // Only react to a row drag within the SAME section; ignore foreign
        // payloads (files) and cross-section row drags.
        if (!rowDrag || rowDrag.section !== section) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (rowDragOverId !== id) setRowDragOverId(id)
      },
      onDrop: (e: React.DragEvent<HTMLButtonElement>) => {
        if (!rowDrag || rowDrag.section !== section) return
        e.preventDefault()
        e.stopPropagation()
        const next = reorderIds(ids, rowDrag.id, id)
        setRowOrders(prev => ({ ...prev, [section]: next }))
        persistRowOrder(section, next)
        setRowDrag(null)
        setRowDragOverId(null)
      },
      style: {
        opacity: rowDrag?.section === section && rowDrag.id === id ? 0.5 : undefined,
        boxShadow:
          rowDrag?.section === section && rowDragOverId === id && rowDrag.id !== id
            ? 'inset 0 2px 0 0 var(--mm-sidebar-text-hover, #1264a3)'
            : undefined,
      } as React.CSSProperties,
    }
  }

  // Apply the restored width to the owning .channel-list aside AND sync the
  // --sidebar-track custom property on .app-shell so the grid track matches.
  // useLayoutEffect (vs useEffect) runs synchronously after DOM mutation but
  // before the browser paints, eliminating the one-frame flash where the
  // sidebar renders at the CSS default 260px before jumping to the saved width.
  // Density is the single source of truth on <html> (set in app/layout.tsx);
  // the sidebar no longer mirrors data-density onto the aside.
  useLayoutEffect(() => {
    const aside = rootRef.current?.parentElement
    if (!aside) return
    const saved = readSidebarWidth()
    if (saved != null && window.innerWidth > SIDEBAR_RESIZE_BREAKPOINT) {
      aside.style.setProperty('width', `${saved}px`)
      aside.style.setProperty('max-width', `${saved}px`)
      // Keep the grid track in sync so chat-pane starts at the sidebar's
      // right edge instead of overflowing the fixed 260px default track.
      const shell = aside.parentElement
      shell?.style.setProperty('--sidebar-track', `${saved}px`)
    }
  }, [])

  // Drag-resize: pointer-driven width update with clamp + persistence.
  const onResizePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (window.innerWidth <= SIDEBAR_RESIZE_BREAKPOINT) return
    const aside = rootRef.current?.parentElement
    if (!aside) return
    e.preventDefault()
    const startWidth = aside.getBoundingClientRect().width
    resizeStateRef.current = { startX: e.clientX, startWidth }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const shell = aside.parentElement
    const onMove = (ev: PointerEvent) => {
      const state = resizeStateRef.current
      if (!state) return
      const next = clampSidebarWidth(state.startWidth + (ev.clientX - state.startX))
      aside.style.setProperty('width', `${next}px`)
      aside.style.setProperty('max-width', `${next}px`)
      // Sync grid track so chat-pane right-edge tracks the sidebar during drag.
      shell?.style.setProperty('--sidebar-track', `${next}px`)
    }
    const onUp = () => {
      resizeStateRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      try {
        const width = clampSidebarWidth(aside.getBoundingClientRect().width)
        window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width))
      } catch { /* ignore */ }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [])

  function dragHandlersFor(slot: SidebarSlotId) {
    return {
      draggable: true,
      onDragStart: (e: React.DragEvent<HTMLDetailsElement>) => {
        setDraggedSlot(slot)
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', `slot:${slot}`)
      },
      onDragEnd: () => {
        setDraggedSlot(null)
        setDragOverSlot(null)
      },
      onDragOver: (e: React.DragEvent<HTMLDetailsElement>) => {
        if (!draggedSlot) return
        // Only react to slot-drag payloads; ignore foreign drops (files, etc.)
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (slot !== dragOverSlot) setDragOverSlot(slot)
      },
      onDrop: (e: React.DragEvent<HTMLDetailsElement>) => {
        e.preventDefault()
        if (!draggedSlot || draggedSlot === slot) {
          setDraggedSlot(null); setDragOverSlot(null)
          return
        }
        const fromIdx = slotOrder.indexOf(draggedSlot)
        const toIdx = slotOrder.indexOf(slot)
        if (fromIdx < 0 || toIdx < 0) {
          setDraggedSlot(null); setDragOverSlot(null)
          return
        }
        const next = moveSlot(slotOrder, fromIdx, toIdx)
        setSlotOrder(next)
        persistSidebarOrder(next)
        setDraggedSlot(null)
        setDragOverSlot(null)
      },
      isDragOver: dragOverSlot === slot && draggedSlot !== null && draggedSlot !== slot,
    }
  }

  // ── Filter & group channels honoring manage-sidebar prefs ──
  // 1. Apply manage filters (mode + hideMuted + sortAlpha) before grouping.
  function applyManageFilter(list: Channel[]): Channel[] {
    let next = list
    if (manageSidebarPrefs.hideMuted) {
      next = next.filter(c => !mutedIds.has(c.id))
    }
    if (manageSidebarPrefs.filterMode === 'unread') {
      next = next.filter(c => (c.unread_count ?? 0) > 0 || (c.mention_count ?? 0) > 0)
    }
    // 'active' mode: best-effort — we don't have last_message_at on the channel
    // payload; keep as-is. The audit recommends this filter using the unread API
    // data which already trims down to active channels in practice.
    if (manageSidebarPrefs.sortAlpha) {
      next = [...next].sort((a, b) => (a.display_name || a.name).localeCompare(b.display_name || b.name))
    }
    return next
  }

  // Apply the quick-filter (case-insensitive, by visible name) after manage filters.
  function applyQuickFilter(list: Channel[]): Channel[] {
    if (!filterQuery) return list
    return list.filter(c => channelFilterLabel(c).includes(filterQuery))
  }

  const starredChannels = applyQuickFilter(applyManageFilter(channels.filter(c => starredIds.has(c.id))))
  const allRegularChannels = applyQuickFilter(applyManageFilter(channels.filter(c => c.type !== 'D' && c.type !== 'G')))
  const dmChannels = applyQuickFilter(applyManageFilter(channels.filter(c => c.type === 'D' || c.type === 'G')))

  // 'No matches' state: a query is active but nothing in any conversation list matches.
  const filterHasMatches =
    starredChannels.length > 0 || allRegularChannels.length > 0 || dmChannels.length > 0
  const showNoMatches = filterQuery.length > 0 && !filterHasMatches

  // Build the section index from server-stored categories.
  const categoryIndex = new Map<string, string>()
  for (const row of channelCategories ?? []) {
    categoryIndex.set(row.channel_id, row.category)
  }
  const grouped = groupChannelsBySection(allRegularChannels, categoryIndex)
  const customSectionNames = Array.from(grouped.sections.keys()).sort()
  // Channels in the default section = ungrouped ∪ starred (we want starred to also live in Channels visually if they're not in a custom section)
  // We let starred section show separately so we drop them from the default section to avoid double-render.
  const regularChannels = grouped.ungrouped.filter(c => !starredIds.has(c.id))
  const MoreIcon = MORE_ICON
  const isAdmin = me && isPlatformAdmin(me.platform_role)

  // Custom-status emoji lookup for DM peers (Slack shows the peer's status
  // emoji next to the presence dot). Sourced from the user lists already
  // passed to the sidebar — no new fetch, no breaking existing props.
  const customStatusEmoji = new Map<string, string>()
  for (const u of [...teamMembers, ...dmPreview]) {
    if (u?.id && u.status_emoji) customStatusEmoji.set(u.id, u.status_emoji)
  }

  // Sync muted channels from the server when the workspace changes.
  useEffect(() => {
    if (!activeTeamId) return
    let cancelled = false
    void (async () => {
      const next = await syncMutedChannels(activeTeamId)
      if (!cancelled) setMutedIds(next)
    })()
    return () => { cancelled = true }
  }, [activeTeamId])

  // Re-read on context-menu close so toggling mute updates the icon immediately.
  useEffect(() => {
    if (contextMenu === null) {
      setMutedIds(readMutedChannels())
    }
  }, [contextMenu])

  const openContextMenu = (e: React.MouseEvent, ch: Channel) => {
    e.preventDefault()
    setContextMenu({
      id: ch.id,
      name: ch.name,
      displayName: ch.display_name || ch.name,
      type: ch.type,
      x: e.clientX,
      y: e.clientY,
    })
  }

  /* Check if an item from "More" submenu is currently active */
  const moreItemActive = MORE_MODULE_KEYS.includes(activeModule || '')

  return (
    <>
      {/* ── Slack-style top nav (Home, Threads, Activity, Later) ── */}
      <nav className="sidebar-top-nav" ref={rootRef}>
        {TOP_NAV_ITEMS.map(item => {
          const Icon = item.icon
          /* "Home" is active when no module is selected (default chat view) */
          const isActive = item.module === 'home'
            ? !activeModule
            : activeModule === item.module
          return (
            <button
              key={item.module}
              type="button"
              className={`sidebar-nav-item${isActive ? ' active' : ''}`}
              onClick={() => onNavigateModule(item.module)}
            >
              <Icon size={16} className="sidebar-nav-icon" />
              <span className="sidebar-nav-label">{item.label}</span>
            </button>
          )
        })}

        {/* More button — expands submenu */}
        <button
          type="button"
          className={`sidebar-nav-item${moreMenuOpen || moreItemActive ? ' active' : ''}`}
          onClick={() => setMoreMenuOpen(v => !v)}
        >
          <MoreIcon size={16} className="sidebar-nav-icon" />
          <span className="sidebar-nav-label">More</span>
        </button>
      </nav>

      {/* ── More submenu (slides open below top-nav) ── */}
      {moreMenuOpen && (
        <div className="sidebar-more-menu">
          {MORE_NAV_ITEMS.map(item => {
            const Icon = item.icon
            const isActive = activeModule === item.module || (item.altModules?.includes(activeModule || '') ?? false)
            return (
              <button
                key={item.module}
                type="button"
                className={`sidebar-nav-item sidebar-nav-item--sub${isActive ? ' active' : ''}`}
                onClick={() => { setMoreMenuOpen(() => false); onNavigateModule(item.module) }}
              >
                <Icon size={15} className="sidebar-nav-icon" />
                <span className="sidebar-nav-label">{item.label}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* ── Scrollable channel/DM area ── */}
      <div className="sidebar-scrollable">
        {/* Quick filter — filters visible channels/DMs by name (Esc clears). */}
        <div className="sidebar-quick-filter">
          <Search size={14} className="sidebar-quick-filter-icon" aria-hidden="true" />
          <input
            type="text"
            className="sidebar-quick-filter-input"
            placeholder="Filter conversations"
            aria-label="Filter conversations"
            value={quickFilter}
            onChange={(e) => setQuickFilter(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setQuickFilter('') } }}
          />
          {quickFilter && (
            <button
              type="button"
              className="sidebar-quick-filter-clear"
              aria-label="Clear filter"
              onClick={() => setQuickFilter('')}
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Manage sidebar (filter / sort / hide muted — Slack §1.4) */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 12px 0' }}>
          <ManageSidebarMenu onChange={setManageSidebarPrefs} />
        </div>

        {showNoMatches && (
          <p className="sidebar-quick-filter-empty">No matches</p>
        )}

        {/* ── Conversation slots in user-saved order (Slack §1.4) ── */}
        {slotOrder.map(slot => {
          if (slot === 'starred') {
            if (starredChannels.length === 0) return null
            return (
              (() => {
                const rows = orderedRows('starred', starredChannels)
                const ids = rows.map(c => c.id)
                return (
              <SidebarSection key="slot-starred" id="starred" title="Starred"
                {...dragHandlersFor('starred')}>
                {rows.map(item => (
                  <button type="button"
                    className={`channel${channel?.id === item.id && !activeModule ? ' active' : ''}${(item.unread_count ?? 0) > 0 ? ' channel--unread' : ''}`}
                    key={`star-${item.id}`}
                    onContextMenu={(e) => openContextMenu(e, item)}
                    onClick={() => onSelectChannel(item)}
                    {...rowDragHandlersFor('starred', item.id, ids)}>
                    <Star size={14} className="channel-icon" style={{ color: '#f5ab00', fill: '#f5ab00' }} />
                    <span className="channel-name">{item.display_name || item.name}</span>
                    {(item.unread_count ?? 0) > 0 ? (
                      <span className="channel-unread">{item.unread_count}</span>
                    ) : null}
                  </button>
                ))}
              </SidebarSection>
                )
              })()
            )
          }

          if (slot === '__custom__') {
            // Custom user-defined sections — collapsed under one slot so users
            // can drag the whole group of customs above/below the built-ins.
            return customSectionNames.map(secKey => {
              const list = grouped.sections.get(secKey) || []
              if (list.length === 0) return null
              const sectionId = `custom-${secKey}`
              const rows = orderedRows(sectionId, list)
              const ids = rows.map(c => c.id)
              return (
                <SidebarSection
                  key={`section-${secKey}`}
                  id={sectionId}
                  title={sectionLabel(secKey)}
                  {...dragHandlersFor('__custom__')}
                >
                  {rows.map(item => {
                    const muted = mutedIds.has(item.id)
                    const mentions = item.mention_count ?? 0
                    const unread = item.unread_count ?? 0
                    return (
                      <button type="button"
                        className={`channel${channel?.id === item.id && !activeModule ? ' active' : ''}${unread > 0 ? ' channel--unread' : ''}${muted ? ' channel--muted' : ''}${mentions > 0 ? ' channel--mention' : ''}`}
                        key={`${secKey}-${item.id}`}
                        title={item.purpose ? `${item.display_name || item.name}\n${item.purpose}` : (item.display_name || item.name)}
                        onContextMenu={(e) => openContextMenu(e, item)}
                        onClick={() => onSelectChannel(item)}
                        {...rowDragHandlersFor(sectionId, item.id, ids)}>
                        {muted
                          ? <BellOff size={14} className="channel-icon" aria-label="Muted" />
                          : starredIds.has(item.id)
                            ? <Star size={14} className="channel-icon" style={{ color: '#f5ab00', fill: '#f5ab00' }} />
                            : item.type === 'P' ? <Lock size={15} className="channel-icon" /> : <Hash size={15} className="channel-icon" />}
                        <span className="channel-name">{item.display_name || item.name}</span>
                        {mentions > 0 ? (
                          <span className="channel-mention-pill" aria-label={`${mentions} unread mentions`}>{mentions}</span>
                        ) : unread > 0 ? (
                          <span className="channel-unread">{unread}</span>
                        ) : null}
                      </button>
                    )
                  })}
                </SidebarSection>
              )
            })
          }

          if (slot === 'channels') {
            const rows = orderedRows('channels', regularChannels)
            const ids = rows.map(c => c.id)
            return (
              <SidebarSection key="slot-channels" id="channels" title="Channels" onAdd={onNewChannel}
                {...dragHandlersFor('channels')}>
                {rows.map(item => {
                  const muted = mutedIds.has(item.id)
                  const mentions = item.mention_count ?? 0
                  const unread = item.unread_count ?? 0
                  return (
                    <button type="button"
                      className={`channel${channel?.id === item.id && !activeModule ? ' active' : ''}${unread > 0 ? ' channel--unread' : ''}${muted ? ' channel--muted' : ''}${mentions > 0 ? ' channel--mention' : ''}`}
                      key={item.id}
                      title={item.purpose ? `${item.display_name || item.name}\n${item.purpose}` : (item.display_name || item.name)}
                      onContextMenu={(e) => openContextMenu(e, item)}
                      onClick={() => onSelectChannel(item)}
                      {...rowDragHandlersFor('channels', item.id, ids)}>
                      {muted
                        ? <BellOff size={14} className="channel-icon" aria-label="Muted" />
                        : starredIds.has(item.id)
                          ? <Star size={14} className="channel-icon" style={{ color: '#f5ab00', fill: '#f5ab00' }} />
                          : item.type === 'P' ? <Lock size={15} className="channel-icon" /> : <Hash size={15} className="channel-icon" />}
                      <span className="channel-name">{item.display_name || item.name}</span>
                      {mentions > 0 ? (
                        <span className="channel-mention-pill" aria-label={`${mentions} unread mentions`}>{mentions}</span>
                      ) : unread > 0 ? (
                        <span className="channel-unread">{unread}</span>
                      ) : draftIds.has(item.id) ? (
                        <PenLine
                          size={12}
                          className="channel-draft-icon"
                          style={{ opacity: 1, marginLeft: 'auto', color: 'var(--mm-sidebar-text-hover)' }}
                        />
                      ) : null}
                    </button>
                  )
                })}
                {/* Browse channels link */}
                <button
                  type="button"
                  className="channel channel--browse"
                  onClick={onBrowseChannels}
                >
                  <Plus size={13} className="channel-icon" />
                  <span className="channel-name">Add channels</span>
                </button>
              </SidebarSection>
            )
          }

          if (slot === 'dms') {
            const rows = orderedRows('dms', dmChannels)
            const ids = rows.map(c => c.id)
            return (
              <SidebarSection key="slot-dms" id="dms" title="Direct messages" onAdd={onNewMessage}
                {...dragHandlersFor('dms')}>
                {rows.map(item => {
                  if (item.type === 'G') {
                    return (
                      <button type="button"
                        className={`channel${channel?.id === item.id && !activeModule ? ' active' : ''}${(item.unread_count ?? 0) > 0 ? ' channel--unread' : ''}`}
                        key={item.id}
                        onContextMenu={(e) => openContextMenu(e, item)}
                        onClick={() => onSelectChannel(item)}
                        {...rowDragHandlersFor('dms', item.id, ids)}>
                        <div className="dm-group-badge">
                          {item.display_name.split(',').length + 1}
                        </div>
                        <span className="channel-name">{item.display_name}</span>
                        {(item.unread_count ?? 0) > 0 ? (
                          <span className="channel-unread">{item.unread_count}</span>
                        ) : null}
                      </button>
                    )
                  }
                  const peerId = item.name.split('__').find(id => id !== me?.id) || ''
                  const status = getStatus(peerId)
                  const peerEmoji = customStatusEmoji.get(peerId)
                  return (
                    <button type="button"
                      className={`channel${channel?.id === item.id && !activeModule ? ' active' : ''}${(item.unread_count ?? 0) > 0 ? ' channel--unread' : ''}`}
                      key={item.id}
                      onContextMenu={(e) => openContextMenu(e, item)}
                      onClick={() => onSelectChannel(item)}
                      {...rowDragHandlersFor('dms', item.id, ids)}>
                      <span className={`presence presence--${status}`} aria-hidden="true" />
                      <span className="channel-name">{item.dm_peer_display || item.display_name || item.name}</span>
                      {peerEmoji ? (
                        <span className="channel-status-emoji" aria-hidden="true">{peerEmoji}</span>
                      ) : null}
                      {(item.unread_count ?? 0) > 0 ? (
                        <span className="channel-unread">{item.unread_count}</span>
                      ) : null}
                    </button>
                  )
                })}
                {/* Add teammates shortcut */}
                <button
                  type="button"
                  className="channel channel--browse"
                  onClick={onNewMessage}
                >
                  <Plus size={13} className="channel-icon" />
                  <span className="channel-name">Add coworkers</span>
                </button>
              </SidebarSection>
            )
          }

          return null
        })}

        {/* Enterprise */}
        <SidebarSection id="enterprise" title="Enterprise">
          {ENTERPRISE_NAV_ITEMS.map(item => {
            const Icon = item.icon
            const isActive = activeModule === item.module
            return (
              <button
                key={item.module}
                type="button"
                className={`channel${isActive ? ' active' : ''}`}
                onClick={() => onNavigateModule(item.module)}
              >
                <Icon size={15} className="channel-icon" />
                <span className="channel-name">{item.label}</span>
              </button>
            )
          })}
        </SidebarSection>

        {contextMenu && (
          <ChannelContextMenu
            target={contextMenu}
            isStarred={starredIds.has(contextMenu.id)}
            onToggleStar={() => onToggleStar(contextMenu.id)}
            onOpenInfo={onOpenChannelInfo ? () => onOpenChannelInfo(contextMenu.id) : undefined}
            onLeave={onLeaveChannel ? () => onLeaveChannel(contextMenu.id) : undefined}
            customSections={customSectionNames}
            currentSection={categoryIndex.get(contextMenu.id)}
            onMoveToSection={onMoveChannelToSection
              ? (section) => { onMoveChannelToSection(contextMenu.id, section) }
              : undefined}
            onCreateNewSection={onMoveChannelToSection
              ? () => { setCreatingSection({ channelId: contextMenu.id }); setNewSectionName('') }
              : undefined}
            onRemoveFromSection={onRemoveChannelFromSection && categoryIndex.get(contextMenu.id)
              ? () => { onRemoveChannelFromSection(contextMenu.id) }
              : undefined}
            onClose={() => setContextMenu(null)}
          />
        )}

        {/* New-section name prompt (overlays sidebar) */}
        {creatingSection && (
          <div
            role="dialog"
            aria-label="Create new section"
            className="sidebar-section-create"
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
              display: 'grid', placeItems: 'center', zIndex: 1600,
            }}
            onClick={(e) => { if (e.target === e.currentTarget) setCreatingSection(null) }}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const name = newSectionName.trim()
                if (!name || !onMoveChannelToSection) { setCreatingSection(null); return }
                onMoveChannelToSection(creatingSection.channelId, sectionKey(name))
                setCreatingSection(null)
              }}
              style={{
                background: 'var(--mm-bg, #fff)', padding: 18,
                borderRadius: 12, minWidth: 320,
                boxShadow: 'var(--mm-shadow-card, 0 8px 24px rgba(0,0,0,0.18))',
                display: 'flex', flexDirection: 'column', gap: 10,
              }}
            >
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Create new section</h3>
              <input
                autoFocus
                type="text"
                placeholder="Section name (e.g. Projects)"
                value={newSectionName}
                onChange={(e) => setNewSectionName(e.target.value)}
                maxLength={50}
                style={{
                  padding: '8px 10px', border: '1px solid var(--mm-border)',
                  borderRadius: 8, fontSize: 13,
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="ghost-button" onClick={() => setCreatingSection(null)}>Cancel</button>
                <button type="submit" className="slack-button" disabled={!newSectionName.trim()}>Create &amp; move</button>
              </div>
            </form>
          </div>
        )}

        {/* Administration (admin-only) */}
        {isAdmin && (
          <SidebarSection id="administration" title="Administration">
            {ADMIN_NAV_ITEMS.map(item => {
              const Icon = item.icon
              const isActive = activeModule === item.module
              return (
                <button
                  key={item.module}
                  type="button"
                  className={`channel${isActive ? ' active' : ''}`}
                  onClick={() => onNavigateModule(item.module)}
                >
                  <Icon size={15} className="channel-icon" />
                  <span className="channel-name">{item.label}</span>
                </button>
              )
            })}
          </SidebarSection>
        )}
      </div>

      {/* Drag handle on the rail's right edge — resize 180-420px, persisted. */}
      <div
        className="sidebar-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={onResizePointerDown}
        onDoubleClick={() => {
          const aside = rootRef.current?.parentElement
          if (!aside) return
          aside.style.removeProperty('width')
          aside.style.removeProperty('max-width')
          // Reset grid track back to the CSS default (var fallback: 260px).
          aside.parentElement?.style.removeProperty('--sidebar-track')
          try { window.localStorage.removeItem(SIDEBAR_WIDTH_KEY) } catch { /* ignore */ }
        }}
      />
    </>
  )
}
