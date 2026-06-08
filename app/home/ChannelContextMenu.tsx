'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Star, BellOff, Bell, Link2, Info, LogOut, Check, FolderPlus, FolderMinus, ChevronRight, MailCheck, Archive, Lock, Hash } from 'lucide-react'
import { isChannelMuted, toggleMuteChannel } from '@/lib/channels/channelMute'
import { apiFetch } from '@/lib/api/apiClient'
import { toast } from '@/lib/ui/toast'

export interface ChannelContextMenuTarget {
  id: string
  name: string
  displayName: string
  type?: string
  x: number
  y: number
}

interface ItemDef {
  id: string
  label: string
  icon: React.ReactNode
  onSelect: () => void | Promise<void>
  danger?: boolean
  disabled?: boolean
  submenu?: ItemDef[]
}

interface ChannelContextMenuProps {
  target: ChannelContextMenuTarget
  isStarred: boolean
  onToggleStar: () => void
  onOpenInfo?: () => void
  onLeave?: () => void
  /** Called after a successful archive/convert so the parent can refresh its list. */
  onChanged?: () => void
  /** Existing custom-section keys (already slug-form). */
  customSections?: string[]
  /** The section the target is currently in, if any. */
  currentSection?: string
  onMoveToSection?: (sectionKey: string) => void
  onCreateNewSection?: () => void
  onRemoveFromSection?: () => void
  onClose: () => void
}

const MENU_WIDTH = 240
const MENU_PAD = 8

export function ChannelContextMenu({
  target,
  isStarred,
  onToggleStar,
  onOpenInfo,
  onLeave,
  onChanged,
  customSections,
  currentSection,
  onMoveToSection,
  onCreateNewSection,
  onRemoveFromSection,
  onClose,
}: ChannelContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [muted, setMuted] = useState<boolean>(() => isChannelMuted(target.id))
  const [copied, setCopied] = useState(false)
  const [focusIndex, setFocusIndex] = useState(0)
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /* Clamp the menu inside the viewport. */
  const left = Math.min(target.x, window.innerWidth - MENU_WIDTH - MENU_PAD)
  const topRaw = target.y
  const isDM = target.type === 'D' || target.type === 'G'
  const isPrivate = target.type === 'P'

  const onArchive = async () => {
    if (busy) return
    const label = `#${target.displayName}`
    if (!window.confirm(`Archive ${label}? Members will lose access until it is unarchived.`)) {
      onClose()
      return
    }
    setBusy(true)
    try {
      const res = await apiFetch('/api/channels', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: target.id, action: 'archive' }),
      })
      if (res.ok) {
        toast.success(`Archived ${label}`)
        onChanged?.()
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(data.error || 'archive_failed')
      }
    } catch {
      toast.error('archive_failed')
    } finally {
      setBusy(false)
      onClose()
    }
  }

  const onConvert = async () => {
    if (busy) return
    const label = `#${target.displayName}`
    const targetType = isPrivate ? 'O' : 'P'
    const verb = isPrivate ? 'public' : 'private'
    if (!window.confirm(`Convert ${label} to ${verb}? This cannot always be undone.`)) {
      onClose()
      return
    }
    setBusy(true)
    try {
      const res = await apiFetch(`/api/channels/${encodeURIComponent(target.id)}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: targetType }),
      })
      if (res.ok) {
        toast.success(`Converted ${label} to ${verb}`)
        onChanged?.()
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(data.error || 'convert_failed')
      }
    } catch {
      toast.error('convert_failed')
    } finally {
      setBusy(false)
      onClose()
    }
  }

  const items: ItemDef[] = []
  items.push({
    id: 'star',
    label: isStarred ? 'Unstar' : 'Star',
    icon: <Star size={14} />,
    onSelect: () => {
      onToggleStar()
      onClose()
    },
  })
  items.push({
    id: 'mark-read',
    label: 'Mark as read',
    icon: <MailCheck size={14} />,
    onSelect: async () => {
      try {
        await apiFetch('/api/collab/read-state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel_id: target.id, last_read_at: Date.now(), mode: 'set' }),
        })
      } catch { /* silent */ }
      onClose()
    },
  })
  items.push({
    id: 'mute',
    label: muted ? 'Unmute channel' : 'Mute channel',
    icon: muted ? <Bell size={14} /> : <BellOff size={14} />,
    onSelect: async () => {
      const next = await toggleMuteChannel(target.id)
      setMuted(next)
      onClose()
    },
  })
  items.push({
    id: 'copy',
    label: copied ? 'Copied!' : 'Copy link to channel',
    icon: copied ? <Check size={14} /> : <Link2 size={14} />,
    onSelect: async () => {
      try {
        const url = `${window.location.origin}/home?channel=${encodeURIComponent(target.name)}`
        await navigator.clipboard.writeText(url)
        setCopied(true)
        setTimeout(() => onClose(), 600)
      } catch {
        onClose()
      }
    },
  })
  if (onOpenInfo) {
    items.push({
      id: 'info',
      label: isDM ? 'View profile' : 'Open channel details',
      icon: <Info size={14} />,
      onSelect: () => {
        onOpenInfo()
        onClose()
      },
    })
  }

  /* Move to section — DM channels are skipped (sections are channel-only). */
  if (!isDM && onMoveToSection) {
    const sectionItems: ItemDef[] = []
    for (const sec of customSections ?? []) {
      if (sec === currentSection) continue
      sectionItems.push({
        id: `move-to-${sec}`,
        label: sec.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        icon: <FolderPlus size={14} />,
        onSelect: () => {
          onMoveToSection(sec)
          onClose()
        },
      })
    }
    if (onCreateNewSection) {
      sectionItems.push({
        id: 'move-to-new',
        label: 'Create new section…',
        icon: <FolderPlus size={14} />,
        onSelect: () => {
          onCreateNewSection()
          onClose()
        },
      })
    }
    if (sectionItems.length > 0) {
      items.push({
        id: 'move-to-section',
        label: 'Move to section',
        icon: <FolderPlus size={14} />,
        onSelect: () => setOpenSubmenu(s => s === 'move-to-section' ? null : 'move-to-section'),
        submenu: sectionItems,
      })
    }
  }
  if (!isDM && onRemoveFromSection && currentSection) {
    items.push({
      id: 'remove-from-section',
      label: 'Remove from section',
      icon: <FolderMinus size={14} />,
      onSelect: () => {
        onRemoveFromSection()
        onClose()
      },
    })
  }
  if (!isDM && (isPrivate || target.type === 'O')) {
    items.push({
      id: 'convert',
      label: isPrivate ? 'Convert to public' : 'Convert to private',
      icon: isPrivate ? <Hash size={14} /> : <Lock size={14} />,
      disabled: busy,
      onSelect: onConvert,
    })
  }
  if (!isDM) {
    items.push({
      id: 'archive',
      label: 'Archive channel',
      icon: <Archive size={14} />,
      danger: true,
      disabled: busy,
      onSelect: onArchive,
    })
  }
  if (onLeave && !isDM) {
    items.push({
      id: 'leave',
      label: 'Leave channel',
      icon: <LogOut size={14} />,
      danger: true,
      onSelect: () => {
        onLeave()
        onClose()
      },
    })
  }

  /* Focus the first item once mounted so keyboard nav is reachable. */
  useEffect(() => {
    itemRefs.current[0]?.focus()
  }, [])

  /* Compute clamped vertical position once the node is mounted (so we know height). */
  const [top, setTop] = useState(topRaw)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const h = node.offsetHeight || items.length * 36 + 12
    const next = Math.min(topRaw, window.innerHeight - h - MENU_PAD)
    setTop(Math.max(MENU_PAD, next))
  }, [topRaw, items.length])

  /* Click-outside + Escape. */
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const onItemKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      const n = items.length
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const next = (index + 1) % n
        setFocusIndex(next)
        itemRefs.current[next]?.focus()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const next = (index - 1 + n) % n
        setFocusIndex(next)
        itemRefs.current[next]?.focus()
      } else if (e.key === 'Home') {
        e.preventDefault()
        setFocusIndex(0)
        itemRefs.current[0]?.focus()
      } else if (e.key === 'End') {
        e.preventDefault()
        setFocusIndex(n - 1)
        itemRefs.current[n - 1]?.focus()
      }
    },
    [items.length]
  )

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={`Actions for ${target.displayName}`}
      className="channel-context-menu"
      style={{
        position: 'fixed',
        top,
        left,
        width: MENU_WIDTH,
        zIndex: 1500,
      }}
    >
      <div className="channel-context-menu-header">
        <span className="channel-context-menu-title">
          {isDM ? target.displayName : `#${target.displayName}`}
        </span>
      </div>
      <div className="channel-context-menu-items">
        {items.map((item, i) => (
          <div key={item.id} style={{ position: 'relative' }}>
            <button
              ref={el => { itemRefs.current[i] = el }}
              type="button"
              role="menuitem"
              tabIndex={i === focusIndex ? 0 : -1}
              disabled={item.disabled}
              aria-haspopup={item.submenu ? 'menu' : undefined}
              aria-expanded={item.submenu ? openSubmenu === item.id : undefined}
              className={`channel-context-menu-item${item.danger ? ' channel-context-menu-item--danger' : ''}`}
              onClick={() => { void item.onSelect() }}
              onKeyDown={e => onItemKeyDown(e, i)}
              onFocus={() => setFocusIndex(i)}
            >
              <span aria-hidden="true" className="channel-context-menu-icon">{item.icon}</span>
              <span className="channel-context-menu-label">{item.label}</span>
              {item.submenu && <ChevronRight size={12} style={{ marginLeft: 'auto', opacity: 0.6 }} />}
            </button>
            {item.submenu && openSubmenu === item.id && (
              <div
                role="menu"
                className="channel-context-menu"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: '100%',
                  marginLeft: 4,
                  width: MENU_WIDTH,
                  zIndex: 1501,
                }}
              >
                <div className="channel-context-menu-items">
                  {item.submenu.map(sub => (
                    <button
                      key={sub.id}
                      type="button"
                      role="menuitem"
                      className="channel-context-menu-item"
                      onClick={() => { void sub.onSelect() }}
                    >
                      <span aria-hidden="true" className="channel-context-menu-icon">{sub.icon}</span>
                      <span className="channel-context-menu-label">{sub.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>,
    document.body
  )
}
