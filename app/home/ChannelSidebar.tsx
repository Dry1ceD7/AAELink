'use client'

import { useState, useEffect } from 'react'
import { ChevronDown, Plus, Hash, Lock, Star, Search, PenLine, BellOff } from 'lucide-react'
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

  // Load saved slot order on mount.
  useEffect(() => {
    setSlotOrder(readSidebarOrder())
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

  const starredChannels = applyManageFilter(channels.filter(c => starredIds.has(c.id)))
  const allRegularChannels = applyManageFilter(channels.filter(c => c.type !== 'D' && c.type !== 'G'))
  const dmChannels = applyManageFilter(channels.filter(c => c.type === 'D' || c.type === 'G'))

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
      <nav className="sidebar-top-nav">
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
        {/* Manage sidebar (filter / sort / hide muted — Slack §1.4) */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 12px 0' }}>
          <ManageSidebarMenu onChange={setManageSidebarPrefs} />
        </div>

        {/* ── Conversation slots in user-saved order (Slack §1.4) ── */}
        {slotOrder.map(slot => {
          if (slot === 'starred') {
            if (starredChannels.length === 0) return null
            return (
              <SidebarSection key="slot-starred" id="starred" title="Starred"
                {...dragHandlersFor('starred')}>
                {starredChannels.map(item => (
                  <button type="button"
                    className={`channel${channel?.id === item.id && !activeModule ? ' active' : ''}${(item.unread_count ?? 0) > 0 ? ' channel--unread' : ''}`}
                    key={`star-${item.id}`}
                    onContextMenu={(e) => openContextMenu(e, item)}
                    onClick={() => onSelectChannel(item)}>
                    <Star size={14} className="channel-icon" style={{ color: '#f5ab00', fill: '#f5ab00' }} />
                    <span className="channel-name">{item.display_name || item.name}</span>
                    {(item.unread_count ?? 0) > 0 ? (
                      <span className="channel-unread">{item.unread_count}</span>
                    ) : null}
                  </button>
                ))}
              </SidebarSection>
            )
          }

          if (slot === '__custom__') {
            // Custom user-defined sections — collapsed under one slot so users
            // can drag the whole group of customs above/below the built-ins.
            return customSectionNames.map(secKey => {
              const list = grouped.sections.get(secKey) || []
              if (list.length === 0) return null
              return (
                <SidebarSection
                  key={`section-${secKey}`}
                  id={`custom-${secKey}`}
                  title={sectionLabel(secKey)}
                  {...dragHandlersFor('__custom__')}
                >
                  {list.map(item => {
                    const muted = mutedIds.has(item.id)
                    const mentions = item.mention_count ?? 0
                    const unread = item.unread_count ?? 0
                    return (
                      <button type="button"
                        className={`channel${channel?.id === item.id && !activeModule ? ' active' : ''}${unread > 0 ? ' channel--unread' : ''}${muted ? ' channel--muted' : ''}${mentions > 0 ? ' channel--mention' : ''}`}
                        key={`${secKey}-${item.id}`}
                        title={item.purpose ? `${item.display_name || item.name}\n${item.purpose}` : (item.display_name || item.name)}
                        onContextMenu={(e) => openContextMenu(e, item)}
                        onClick={() => onSelectChannel(item)}>
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
            return (
              <SidebarSection key="slot-channels" id="channels" title="Channels" onAdd={onNewChannel}
                {...dragHandlersFor('channels')}>
                {regularChannels.map(item => {
                  const muted = mutedIds.has(item.id)
                  const mentions = item.mention_count ?? 0
                  const unread = item.unread_count ?? 0
                  return (
                    <button type="button"
                      className={`channel${channel?.id === item.id && !activeModule ? ' active' : ''}${unread > 0 ? ' channel--unread' : ''}${muted ? ' channel--muted' : ''}${mentions > 0 ? ' channel--mention' : ''}`}
                      key={item.id}
                      title={item.purpose ? `${item.display_name || item.name}\n${item.purpose}` : (item.display_name || item.name)}
                      onContextMenu={(e) => openContextMenu(e, item)}
                      onClick={() => onSelectChannel(item)}>
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
                        <PenLine size={12} className="channel-draft-icon" />
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
            return (
              <SidebarSection key="slot-dms" id="dms" title="Direct messages" onAdd={onNewMessage}
                {...dragHandlersFor('dms')}>
                {dmChannels.map(item => {
                  if (item.type === 'G') {
                    return (
                      <button type="button"
                        className={`channel${channel?.id === item.id && !activeModule ? ' active' : ''}${(item.unread_count ?? 0) > 0 ? ' channel--unread' : ''}`}
                        key={item.id}
                        onContextMenu={(e) => openContextMenu(e, item)}
                        onClick={() => onSelectChannel(item)}>
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
                  return (
                    <button type="button"
                      className={`channel${channel?.id === item.id && !activeModule ? ' active' : ''}${(item.unread_count ?? 0) > 0 ? ' channel--unread' : ''}`}
                      key={item.id}
                      onContextMenu={(e) => openContextMenu(e, item)}
                      onClick={() => onSelectChannel(item)}>
                      <span className={`presence presence--${status}`} aria-hidden="true" />
                      <span className="channel-name">{item.dm_peer_display || item.display_name || item.name}</span>
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
    </>
  )
}
