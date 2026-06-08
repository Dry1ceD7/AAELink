'use client'

import { Menu, Search, Hash, Lock, Info, Pin, Users } from 'lucide-react'
import { ChannelHeaderDropdown } from '@/components/chat/ChannelHeaderDropdown'
import { ChannelTopicInline } from '@/components/chat/ChannelTopicInline'
import { ChannelNotificationPrefsPopover } from '@/components/chat/ChannelNotificationPrefsPopover'
import { NotificationsBell } from '@/components/notifications/NotificationsBell'

interface ChatHeaderProps {
  channel: { id: string; name: string; display_name: string; type?: string; purpose?: string } | null
  channelTitle: string
  channelsOpen: boolean
  setChannelsOpen: (fn: (v: boolean) => boolean) => void
  starredIds: Set<string>
  onToggleStar: (channelId: string) => void
  onLeaveChannel: (channelId: string) => void
  onInviteToChannel: () => void
  onTopicSaved: (channelId: string, newTopic: string) => void
  searchOpen: boolean
  onSearchOpen: () => void
  channelInfoOpen: boolean
  onToggleChannelInfo: () => void
  pinnedPanelOpen: boolean
  onTogglePinnedPanel: () => void
  memberListOpen: boolean
  onToggleMemberList: () => void
  memberCount: number
  streamUp: boolean
  meExists: boolean
  onOpenChannelNotifPrefs: () => void
}

export function ChatHeader({
  channel,
  channelTitle,
  channelsOpen,
  setChannelsOpen,
  starredIds,
  onToggleStar,
  onLeaveChannel,
  onInviteToChannel,
  onTopicSaved,
  onSearchOpen,
  channelInfoOpen,
  onToggleChannelInfo,
  pinnedPanelOpen,
  onTogglePinnedPanel,
  memberListOpen,
  onToggleMemberList,
  memberCount,
  streamUp,
  meExists,
}: ChatHeaderProps) {
  return (
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
              onToggleStar={() => onToggleStar(channel.id)}
              onLeaveChannel={() => onLeaveChannel(channel.id)}
              onInviteToChannel={onInviteToChannel}
            />
          )}
        </div>
        {channel && channel.type !== 'D' && (
          <ChannelTopicInline
            channelId={channel.id}
            topic={channel.purpose || ''}
            onSaved={(newTopic) => onTopicSaved(channel.id, newTopic)}
          />
        )}
      </div>
      <div className="chat-header-nav">
        <button type="button" className="mm-icon-btn" title="Search messages"
          aria-label="Search messages" onClick={onSearchOpen}>
          <Search size={18} aria-hidden />
        </button>
        <button type="button" className={`mm-icon-btn${channelInfoOpen ? ' mm-icon-btn--active' : ''}`} title="Channel details"
          aria-label="Channel details" aria-pressed={channelInfoOpen}
          onClick={onToggleChannelInfo}>
          <Info size={18} aria-hidden />
        </button>
        <button type="button" className={`mm-icon-btn${pinnedPanelOpen ? ' mm-icon-btn--active' : ''}`} title="Pinned messages"
          aria-label="Pinned messages" aria-pressed={pinnedPanelOpen}
          onClick={onTogglePinnedPanel}>
          <Pin size={16} aria-hidden />
        </button>
        <NotificationsBell enabled={meExists} />
        {channel && channel.type !== 'D' && (
          <ChannelNotificationPrefsPopover
            channelId={channel.id}
            channelName={channel.display_name || channel.name}
          />
        )}
        <button type="button" className={`mm-icon-btn${memberListOpen ? ' mm-icon-btn--active' : ''}`} title="Members"
          aria-label="Channel members" aria-pressed={memberListOpen}
          onClick={onToggleMemberList}
          style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 13, fontWeight: 600 }}>
          <Users size={16} aria-hidden />
          <span style={{ opacity: 0.7 }}>{memberCount || ''}</span>
        </button>
        <span className={`status-pill${streamUp ? ' online' : ''}`}>
          {streamUp ? 'Live' : 'Connecting'}
        </span>
      </div>
    </header>
  )
}
