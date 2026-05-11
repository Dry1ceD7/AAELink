'use client'

import { useState, useEffect } from 'react'
import { ChevronDown, Plus, Hash, Lock, Star, Search, PenLine } from 'lucide-react'
import { displayName, type AppUser } from '@/app/components/chat/ChatMessage'
import { isPlatformAdmin } from '@/lib/platformRole'
import { TOP_NAV_ITEMS, MORE_NAV_ITEMS, MORE_MODULE_KEYS, ENTERPRISE_NAV_ITEMS, ADMIN_NAV_ITEMS, MORE_ICON } from './sidebarNav'

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

/* ── Collapsible sidebar section (Slack-style <details>) ──────── */
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
  moreMenuOpen,
  setMoreMenuOpen,
}: ChannelSidebarProps) {
  const starredChannels = channels.filter(c => starredIds.has(c.id))
  const regularChannels = channels.filter(c => c.type !== 'D' && c.type !== 'G')
  const dmChannels = channels.filter(c => c.type === 'D' || c.type === 'G')
  const MoreIcon = MORE_ICON
  const isAdmin = me && isPlatformAdmin(me.platform_role)

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
        {/* Starred */}
        {starredChannels.length > 0 && (
          <SidebarSection id="starred" title="Starred">
            {starredChannels.map(item => (
              <button type="button"
                className={`channel${channel?.id === item.id && !activeModule ? ' active' : ''}${(item.unread_count ?? 0) > 0 ? ' channel--unread' : ''}`}
                key={`star-${item.id}`}
                onClick={() => onSelectChannel(item)}>
                <Star size={14} className="channel-icon" style={{ color: '#f5ab00', fill: '#f5ab00' }} />
                <span className="channel-name">{item.display_name || item.name}</span>
                {(item.unread_count ?? 0) > 0 ? (
                  <span className="channel-unread">{item.unread_count}</span>
                ) : null}
              </button>
            ))}
          </SidebarSection>
        )}

        {/* Channels */}
        <SidebarSection id="channels" title="Channels" onAdd={onNewChannel}>
          {regularChannels.map(item => (
            <button type="button"
              className={`channel${channel?.id === item.id && !activeModule ? ' active' : ''}${(item.unread_count ?? 0) > 0 ? ' channel--unread' : ''}`}
              key={item.id}
              title={item.purpose ? `${item.display_name || item.name}\n${item.purpose}` : (item.display_name || item.name)}
              onContextMenu={(e) => { e.preventDefault(); onToggleStar(item.id) }}
              onClick={() => onSelectChannel(item)}>
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

        {/* Direct messages */}
        <SidebarSection id="dms" title="Direct messages" onAdd={onNewMessage}>
          {dmChannels.map(item => {
            if (item.type === 'G') {
              return (
                <button type="button"
                  className={`channel${channel?.id === item.id && !activeModule ? ' active' : ''}${(item.unread_count ?? 0) > 0 ? ' channel--unread' : ''}`}
                  key={item.id}
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
