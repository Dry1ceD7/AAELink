'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent)
const MOD = IS_MAC ? '⌘' : 'Ctrl'

const GROUPS: { title: string; shortcuts: { keys: string; desc: string }[] }[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: `${MOD} + K`, desc: 'Quick Switcher (jump to anything)' },
      { keys: `${MOD} + Shift + F`, desc: 'Global search across messages' },
      { keys: `${MOD} + Shift + L`, desc: 'Toggle sidebar' },
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
      { keys: `${MOD} + B`, desc: 'Bold' },
      { keys: `${MOD} + I`, desc: 'Italic' },
      { keys: `${MOD} + Shift + X`, desc: 'Strikethrough' },
      { keys: `${MOD} + E`, desc: 'Inline code' },
      { keys: `${MOD} + Shift + 7`, desc: 'Ordered list' },
      { keys: `${MOD} + Shift + 8`, desc: 'Bullet list' },
    ]
  },
  {
    title: 'Actions',
    shortcuts: [
      { keys: `${MOD} + /`, desc: 'Show keyboard shortcuts' },
      { keys: `${MOD} + .`, desc: 'Toggle channel details panel' },
    ]
  }
]

interface Props {
  open: boolean
  onClose: () => void
}

export function KeyboardShortcutsModal({ open, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', onEsc, true)
    return () => window.removeEventListener('keydown', onEsc, true)
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
          <button type="button" className="mm-icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="mm-shortcuts-body">
          {GROUPS.map(g => (
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
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}
