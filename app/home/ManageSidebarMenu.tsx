'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Settings2, Filter, BellOff, ArrowDownAZ, UserCircle2, Check } from 'lucide-react'
import {
  readManageSidebarPrefs,
  persistManageSidebarPrefs,
  type ManageSidebarPrefs,
} from '@/lib/channels/sidebarSections'
import { useMenuNav } from '@/lib/ui/useMenuNav'

interface Props {
  /** Notify the parent when prefs change so the channel list re-filters. */
  onChange?: (prefs: ManageSidebarPrefs) => void
}

const MENU_WIDTH = 240

/**
 * ManageSidebarMenu — Slack's "Manage my sidebar" gear button (§1.4).
 *
 * A compact icon button at the top of the sidebar that opens a dropdown
 * with: Filter (All / Unread only / Active in 30 days), Hide muted,
 * Sort A→Z, Show profile pictures.
 *
 * State lives in localStorage via `readManageSidebarPrefs` /
 * `persistManageSidebarPrefs`. The parent listens via `onChange` and
 * applies the filter to its channel list (page-level concern).
 */
export function ManageSidebarMenu({ onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [prefs, setPrefs] = useState<ManageSidebarPrefs>(() => readManageSidebarPrefs())
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useMenuNav<HTMLDivElement>(open, () => setOpen(false))

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t)) return
      // Allow clicks inside the menu portal — checked via attribute.
      const inMenu = (e.target as HTMLElement)?.closest?.('[data-manage-sidebar-menu]')
      if (inMenu) return
      setOpen(false)
    }
    // Defer so the click that opened it doesn't also close it.
    const t = setTimeout(() => document.addEventListener('mousedown', onClick), 50)
    return () => {
      document.removeEventListener('mousedown', onClick)
      clearTimeout(t)
    }
  }, [open])

  function update<K extends keyof ManageSidebarPrefs>(key: K, value: ManageSidebarPrefs[K]) {
    const next = { ...prefs, [key]: value }
    setPrefs(next)
    persistManageSidebarPrefs(next)
    onChange?.(next)
  }

  // Trigger button position for the portal.
  const rect = triggerRef.current?.getBoundingClientRect()
  const left = rect ? Math.min(rect.left, (typeof window !== 'undefined' ? window.innerWidth : 1200) - MENU_WIDTH - 8) : 0
  const top = rect ? rect.bottom + 6 : 0

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="manage-sidebar-trigger"
        aria-label="Manage sidebar"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <Settings2 size={14} />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          data-manage-sidebar-menu
          role="menu"
          aria-label="Manage sidebar"
          className="aae-pop-in"
          style={{
            position: 'fixed', top, left, width: MENU_WIDTH,
            zIndex: 1450,
            background: 'var(--mm-bg, #fff)',
            border: '1px solid var(--mm-border, rgba(0,0,0,0.1))',
            borderRadius: 10,
            boxShadow: 'var(--mm-shadow-card, 0 8px 24px rgba(0,0,0,0.18))',
            padding: 6,
          }}
        >
          {/* ── Filter group ── */}
          <div role="group" aria-label="Filter conversations" style={{ padding: '4px 8px 2px', fontSize: 11, color: 'var(--mm-muted)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700 }}>
            <Filter size={11} style={{ marginRight: 4, verticalAlign: '-1px' }} /> Filter
          </div>
          {([
            { key: 'all', label: 'All conversations' },
            { key: 'unread', label: 'Unread only' },
            { key: 'active', label: 'Active in 30 days' },
          ] as const).map(opt => (
            <button
              key={opt.key}
              type="button"
              role="menuitemradio"
              aria-checked={prefs.filterMode === opt.key}
              className="manage-sidebar-item"
              onClick={() => update('filterMode', opt.key)}
            >
              <span className="manage-sidebar-check">
                {prefs.filterMode === opt.key ? <Check size={12} /> : null}
              </span>
              <span>{opt.label}</span>
            </button>
          ))}

          <hr style={{ border: 'none', borderTop: '1px solid var(--mm-border-subtle, rgba(0,0,0,0.06))', margin: '4px 0' }} />

          {/* ── Toggles ── */}
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={prefs.hideMuted}
            className="manage-sidebar-item"
            onClick={() => update('hideMuted', !prefs.hideMuted)}
          >
            <span className="manage-sidebar-check">
              {prefs.hideMuted ? <Check size={12} /> : null}
            </span>
            <BellOff size={13} style={{ marginRight: 6 }} />
            Hide muted conversations
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={prefs.sortAlpha}
            className="manage-sidebar-item"
            onClick={() => update('sortAlpha', !prefs.sortAlpha)}
          >
            <span className="manage-sidebar-check">
              {prefs.sortAlpha ? <Check size={12} /> : null}
            </span>
            <ArrowDownAZ size={13} style={{ marginRight: 6 }} />
            Sort A → Z
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={prefs.showProfilePictures}
            className="manage-sidebar-item"
            onClick={() => update('showProfilePictures', !prefs.showProfilePictures)}
          >
            <span className="manage-sidebar-check">
              {prefs.showProfilePictures ? <Check size={12} /> : null}
            </span>
            <UserCircle2 size={13} style={{ marginRight: 6 }} />
            Show profile pictures
          </button>
        </div>,
        document.body
      )}
    </>
  )
}
