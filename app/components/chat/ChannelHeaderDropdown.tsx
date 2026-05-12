'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Star, BellOff, Bell, LogOut, Link2, UserPlus, Archive, Copy } from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'
import { useConfirm } from '@/app/components/a11y'

interface Props {
  channelId: string
  channelName: string
  channelType: string
  isStarred: boolean
  onToggleStar: () => void
  onLeaveChannel: () => void
  onInviteToChannel: () => void
}

/**
 * ChannelHeaderDropdown — Slack-style "chevron" dropdown on the channel name
 * in the header. Shows: Star, Mute/Unmute, Copy Link, Invite, Leave.
 */
export const ChannelHeaderDropdown = memo(function ChannelHeaderDropdown({
  channelId,
  channelName,
  channelType,
  isStarred,
  onToggleStar,
  onLeaveChannel,
  onInviteToChannel,
}: Props) {
  const { confirm, confirmDialog } = useConfirm()
  const [open, setOpen] = useState(false)
  const [muted, setMuted] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Fetch mute state
  useEffect(() => {
    if (!channelId) return
    void (async () => {
      try {
        const res = await apiFetch(`/api/channel-prefs?channel_id=${encodeURIComponent(channelId)}`)
        if (res.ok) {
          const data = await res.json()
          setMuted(Boolean(data.muted))
        }
      } catch { /* ignore */ }
    })()
  }, [channelId])

  const toggleMute = useCallback(async () => {
    const newMuted = !muted
    setMuted(newMuted)
    setOpen(false)
    await apiFetch('/api/channel-prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel_id: channelId,
        level: newMuted ? 'nothing' : 'default',
        muted: newMuted,
      }),
    })
  }, [channelId, muted])

  const copyLink = useCallback(() => {
    const url = `${window.location.origin}/home?channel=${channelId}`
    navigator.clipboard.writeText(url).catch(() => {})
    setCopied(true)
    setTimeout(() => { setCopied(false); setOpen(false) }, 1200)
  }, [channelId])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [open])

  // Don't show for DMs
  if (channelType === 'D') return null

  return (
    <>
    <div className="channel-header-dropdown-wrap" ref={ref}>
      <button
        type="button"
        className="mm-icon-btn channel-header-dropdown-trigger"
        aria-label="Channel options"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <ChevronDown size={16} />
      </button>

      {open && typeof document !== 'undefined' && (
        <div className="channel-header-dropdown-menu" role="menu">
          <button type="button" className="channel-header-dropdown-item" role="menuitem"
            onClick={() => { onToggleStar(); setOpen(false) }}>
            <Star size={14} style={isStarred ? { color: '#f5ab00', fill: '#f5ab00' } : {}} />
            {isStarred ? 'Unstar channel' : 'Star channel'}
          </button>

          <button type="button" className="channel-header-dropdown-item" role="menuitem"
            onClick={() => void toggleMute()}>
            {muted ? <Bell size={14} /> : <BellOff size={14} />}
            {muted ? 'Unmute channel' : 'Mute channel'}
          </button>

          <button type="button" className="channel-header-dropdown-item" role="menuitem"
            onClick={copyLink}>
            {copied ? <Copy size={14} /> : <Link2 size={14} />}
            {copied ? 'Copied!' : 'Copy link'}
          </button>

          <hr className="channel-header-dropdown-sep" />

          <button type="button" className="channel-header-dropdown-item" role="menuitem"
            onClick={() => { onInviteToChannel(); setOpen(false) }}>
            <UserPlus size={14} />
            Invite people
          </button>

          <button type="button" className="channel-header-dropdown-item" role="menuitem"
            onClick={async () => {
              if (!(await confirm({ title: 'Archive channel', message: `Archive #${channelName}? Members can still view history but won't be able to post.`, danger: true, confirmLabel: 'Archive' }))) return
              setOpen(false)
              await apiFetch('/api/channel-info', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channel_id: channelId, archived: true }),
              })
            }}>
            <Archive size={14} />
            Archive channel
          </button>

          <button type="button" className="channel-header-dropdown-item channel-header-dropdown-item--danger" role="menuitem"
            onClick={() => { onLeaveChannel(); setOpen(false) }}>
            <LogOut size={14} />
            Leave channel
          </button>
        </div>
      )}
    </div>
    {confirmDialog}
    </>
  )
})
