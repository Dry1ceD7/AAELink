'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { BellOff, LogOut, Archive, Settings } from 'lucide-react'

export interface ChannelContextMenuState {
  x: number
  y: number
  channelId: string
}

interface Props {
  menu: ChannelContextMenuState | null
  onClose: () => void
  onMute: (channelId: string) => void
  onLeave: (channelId: string) => void
  onArchive: (channelId: string) => void
  onNotificationPreferences: (channelId: string) => void
}

/**
 * ChannelContextMenu — cursor-positioned portal menu for a channel row in the
 * sidebar. Opened from a contextmenu event at {x,y}; closes on outside-click
 * or Esc. All actions are provided by the page via props.
 */
export function ChannelContextMenu({
  menu,
  onClose,
  onMute,
  onLeave,
  onArchive,
  onNotificationPreferences,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu, onClose])

  if (!menu || typeof document === 'undefined') return null

  const run = (fn: (channelId: string) => void) => () => { fn(menu.channelId); onClose() }

  return createPortal(
    <div
      ref={ref}
      className="channel-header-dropdown-menu"
      role="menu"
      style={{ position: 'fixed', top: menu.y, left: menu.x, zIndex: 1000 }}
    >
      <button type="button" className="channel-header-dropdown-item" role="menuitem" onClick={run(onMute)}>
        <BellOff size={14} /> Mute
      </button>
      <button type="button" className="channel-header-dropdown-item" role="menuitem" onClick={run(onNotificationPreferences)}>
        <Settings size={14} /> Notification preferences
      </button>
      <button type="button" className="channel-header-dropdown-item" role="menuitem" onClick={run(onArchive)}>
        <Archive size={14} /> Archive
      </button>
      <hr className="channel-header-dropdown-sep" />
      <button
        type="button"
        className="channel-header-dropdown-item channel-header-dropdown-item--danger"
        role="menuitem"
        onClick={run(onLeave)}
      >
        <LogOut size={14} /> Leave
      </button>
    </div>,
    document.body,
  )
}
