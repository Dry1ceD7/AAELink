'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { X, Search } from 'lucide-react'

const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent)
const MOD = IS_MAC ? '⌘' : 'Ctrl'
const IS_DESKTOP = typeof window !== 'undefined' && !!(window as unknown as { aaelinkDesktop?: unknown }).aaelinkDesktop

const GROUPS: { title: string; shortcuts: { keys: string; desc: string }[] }[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: `${MOD} + K`, desc: 'Quick Switcher (jump to anything)' },
      { keys: `${MOD} + Shift + F`, desc: 'Global search across messages' },
      { keys: `${MOD} + Shift + L`, desc: 'Toggle sidebar' },
      { keys: `${MOD} + [`, desc: 'Previous channel' },
      { keys: `${MOD} + ]`, desc: 'Next channel' },
      { keys: 'Esc', desc: 'Close panel / dialog' },
    ]
  },
  {
    title: 'Messaging',
    shortcuts: [
      { keys: 'Enter', desc: 'Send message' },
      { keys: 'Shift + Enter', desc: 'New line' },
      { keys: '↑', desc: 'Edit your last message (in empty composer)' },
      { keys: '@', desc: '@mention a user (autocomplete)' },
      { keys: ':', desc: ':emoji: autocomplete' },
      { keys: '/', desc: 'Slash commands' },
      { keys: `${MOD} + B`, desc: 'Bold' },
      { keys: `${MOD} + I`, desc: 'Italic' },
      { keys: `${MOD} + Shift + X`, desc: 'Strikethrough' },
      { keys: `${MOD} + E`, desc: 'Inline code' },
      { keys: `${MOD} + Shift + 7`, desc: 'Ordered list' },
      { keys: `${MOD} + Shift + 8`, desc: 'Bullet list' },
      { keys: `${MOD} + Enter`, desc: 'Send forward with comment' },
    ]
  },
  {
    title: 'Files & Media',
    shortcuts: [
      { keys: `${MOD} + U`, desc: 'Upload a file' },
      { keys: 'Drag & Drop', desc: 'Drop files onto the chat area to upload' },
      { keys: `${MOD} + V`, desc: 'Paste image from clipboard' },
    ]
  },
  {
    title: 'Actions',
    shortcuts: [
      { keys: `${MOD} + /`, desc: 'Show keyboard shortcuts' },
      { keys: `${MOD} + .`, desc: 'Toggle channel details panel' },
      { keys: `${MOD} + ,`, desc: 'Open Preferences' },
      { keys: `${MOD} + Shift + M`, desc: 'Mute / unmute current channel' },
      { keys: `${MOD} + Shift + S`, desc: 'Star / unstar current channel' },
    ]
  },
  ...(IS_DESKTOP ? [{
    title: 'Desktop',
    shortcuts: [
      { keys: `${MOD} + =`, desc: 'Zoom in' },
      { keys: `${MOD} + -`, desc: 'Zoom out' },
      { keys: `${MOD} + 0`, desc: 'Reset zoom' },
      { keys: `${MOD} + M`, desc: 'Minimize window' },
      { keys: IS_MAC ? `${MOD} + Ctrl + F` : 'F11', desc: 'Toggle fullscreen' },
    ]
  }] : [])
]

interface Props {
  open: boolean
  onClose: () => void
}

export function KeyboardShortcutsModal({ open, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [filter, setFilter] = useState('')

  // Filtered groups
  const filteredGroups = useMemo(() => {
    if (!filter.trim()) return GROUPS
    const q = filter.toLowerCase()
    return GROUPS
      .map(g => ({
        ...g,
        shortcuts: g.shortcuts.filter(
          s => s.desc.toLowerCase().includes(q) || s.keys.toLowerCase().includes(q)
        )
      }))
      .filter(g => g.shortcuts.length > 0)
  }, [filter])

  const totalShortcuts = useMemo(
    () => GROUPS.reduce((sum, g) => sum + g.shortcuts.length, 0),
    []
  )

  useEffect(() => {
    if (!open) return
    setFilter('')
    const t = setTimeout(() => searchRef.current?.focus(), 50)
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', onEsc, true)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', onEsc, true)
    }
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="mm-modal-overlay" role="presentation">
      <div ref={panelRef} className="mm-modal mm-shortcuts-modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <div className="mm-shortcuts-header">
          <h2>Keyboard Shortcuts</h2>
          <span style={{ fontSize: 11, color: 'var(--mm-muted)', marginLeft: 8 }}>
            {totalShortcuts} shortcuts
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" className="mm-icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {/* Search filter */}
        <div className="mm-forward-search" style={{ margin: '0 16px 8px' }}>
          <Search size={14} />
          <input
            ref={searchRef}
            type="search"
            placeholder="Filter shortcuts…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13 }}
          />
        </div>
        <div className="mm-shortcuts-body">
          {filteredGroups.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--mm-muted)', fontSize: 13 }}>
              No matching shortcuts
            </div>
          ) : (
            filteredGroups.map(g => (
              <section key={g.title} className="mm-shortcuts-group">
                <h3>{g.title}</h3>
                <ul>
                  {g.shortcuts.map(s => (
                    <li key={s.keys}>
                      <span className="mm-shortcut-desc">{s.desc}</span>
                      <kbd className="mm-shortcut-keys">{s.keys}</kbd>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
