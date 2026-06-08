'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Copy, SmilePlus, MessageSquare, Pin, Trash2 } from 'lucide-react'

export interface MessageContextMenuState {
  x: number
  y: number
  postId: string
}

interface Props {
  menu: MessageContextMenuState | null
  onClose: () => void
  onCopyText: (postId: string) => void
  onAddReaction: (postId: string) => void
  onReplyInThread: (postId: string) => void
  onPin: (postId: string) => void
  onDelete: (postId: string) => void
}

/**
 * MessageContextMenu — cursor-positioned portal menu for a chat message.
 * Opened from a contextmenu event at {x,y}; closes on outside-click or Esc.
 * All actions are provided by the page via props (no internal API calls).
 */
export function MessageContextMenu({
  menu,
  onClose,
  onCopyText,
  onAddReaction,
  onReplyInThread,
  onPin,
  onDelete,
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

  const run = (fn: (postId: string) => void) => () => { fn(menu.postId); onClose() }

  return createPortal(
    <div
      ref={ref}
      className="channel-header-dropdown-menu"
      role="menu"
      style={{ position: 'fixed', top: menu.y, left: menu.x, zIndex: 1000 }}
    >
      <button type="button" className="channel-header-dropdown-item" role="menuitem" onClick={run(onCopyText)}>
        <Copy size={14} /> Copy text
      </button>
      <button type="button" className="channel-header-dropdown-item" role="menuitem" onClick={run(onAddReaction)}>
        <SmilePlus size={14} /> Add reaction
      </button>
      <button type="button" className="channel-header-dropdown-item" role="menuitem" onClick={run(onReplyInThread)}>
        <MessageSquare size={14} /> Reply in thread
      </button>
      <button type="button" className="channel-header-dropdown-item" role="menuitem" onClick={run(onPin)}>
        <Pin size={14} /> Pin
      </button>
      <hr className="channel-header-dropdown-sep" />
      <button
        type="button"
        className="channel-header-dropdown-item channel-header-dropdown-item--danger"
        role="menuitem"
        onClick={run(onDelete)}
      >
        <Trash2 size={14} /> Delete
      </button>
    </div>,
    document.body,
  )
}
