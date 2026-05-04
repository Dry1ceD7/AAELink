'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Hash, Keyboard, LayoutGrid, Package, Search, Settings, Shield, Ticket, FileText, MessageSquare, Plus, Users } from 'lucide-react'

export type CommandPaletteItem = {
  id: string
  group: string
  label: string
  hint?: string
  /** Extra strings matched by the filter (e.g. channel slug). */
  keywords?: string[]
  icon?:
    | 'channel'
    | 'settings'
    | 'workspaces'
    | 'search'
    | 'admin'
    | 'tickets'
    | 'documents'
    | 'chat'
    | 'plus'
    | 'members'
    | 'keyboard'
    | 'marketplace'
  run: () => void
}

function itemIcon(kind?: CommandPaletteItem['icon']) {
  const s = 18
  switch (kind) {
    case 'settings':
      return <Settings size={s} aria-hidden="true" />
    case 'workspaces':
      return <LayoutGrid size={s} aria-hidden="true" />
    case 'search':
      return <Search size={s} aria-hidden="true" />
    case 'admin':
      return <Shield size={s} aria-hidden="true" />
    case 'tickets':
      return <Ticket size={s} aria-hidden="true" />
    case 'documents':
      return <FileText size={s} aria-hidden="true" />
    case 'chat':
      return <MessageSquare size={s} aria-hidden="true" />
    case 'plus':
      return <Plus size={s} aria-hidden="true" />
    case 'members':
      return <Users size={s} aria-hidden="true" />
    case 'keyboard':
      return <Keyboard size={s} aria-hidden="true" />
    case 'marketplace':
      return <Package size={s} aria-hidden="true" />
    case 'channel':
    default:
      return <Hash size={s} aria-hidden="true" />
  }
}

function matchesFilter(query: string, item: CommandPaletteItem): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const blob = [item.label, item.hint ?? '', item.group, ...(item.keywords ?? [])].join(' ').toLowerCase()
  return q.split(/\s+/).every(w => blob.includes(w))
}

export type CommandPaletteProps = {
  open: boolean
  onClose: () => void
  items: CommandPaletteItem[]
}

export function CommandPalette({ open, onClose, items }: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)

  const filtered = useMemo(() => items.filter(it => matchesFilter(query, it)), [items, query])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setHighlight(0)
      return
    }
    const t = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [open])

  useEffect(() => {
    setHighlight(h => (filtered.length === 0 ? 0 : Math.min(h, filtered.length - 1)))
  }, [filtered.length, query])

  const runAt = useCallback(
    (idx: number) => {
      const it = filtered[idx]
      if (!it) return
      onClose()
      window.queueMicrotask(() => {
        it.run()
      })
    },
    [filtered, onClose]
  )

  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel) return

    const focusables = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter(el => el.offsetParent !== null || el === document.activeElement)

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        const active = document.activeElement
        if (!active || !panel.contains(active)) return
        const nodes = focusables()
        if (nodes.length === 0) return
        if (nodes.length === 1) {
          e.preventDefault()
          nodes[0].focus()
          return
        }
        const first = nodes[0]
        const last = nodes[nodes.length - 1]
        if (e.shiftKey) {
          if (active === first) {
            e.preventDefault()
            last.focus()
          }
        } else if (active === last) {
          e.preventDefault()
          first.focus()
        }
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlight(h => (filtered.length === 0 ? 0 : (h + 1) % filtered.length))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlight(h => (filtered.length === 0 ? 0 : (h - 1 + filtered.length) % filtered.length))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        runAt(highlight)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, filtered.length, highlight, runAt, onClose])

  if (!open) return null

  const node = (
    <div
      className="mm-cmd-overlay"
      role="presentation"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        className="mm-cmd-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mm-cmd-title"
        onClick={e => e.stopPropagation()}
      >
        <h2 id="mm-cmd-title" className="visually-hidden">
          Quick go
        </h2>
        <div className="mm-cmd-search">
          <Search size={18} className="mm-cmd-search-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            className="mm-cmd-input"
            placeholder="Go to channel, module, or settings"
            value={query}
            onChange={e => setQuery(e.target.value)}
            aria-autocomplete="list"
            aria-controls="mm-cmd-list"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <ul id="mm-cmd-list" className="mm-cmd-list" role="listbox" aria-label="Results">
          {filtered.length === 0 ? (
            <li className="mm-cmd-empty" role="presentation">
              No matches
            </li>
          ) : (
            filtered.map((it, idx) => (
              <li key={it.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={idx === highlight}
                  className={`mm-cmd-row${idx === highlight ? ' mm-cmd-row--active' : ''}`}
                  onMouseEnter={() => setHighlight(idx)}
                  onClick={() => runAt(idx)}
                >
                  <span className="mm-cmd-row-icon" aria-hidden="true">
                    {itemIcon(it.icon)}
                  </span>
                  <span className="mm-cmd-row-text">
                    <span className="mm-cmd-row-label">{it.label}</span>
                    {it.hint ? <span className="mm-cmd-row-hint">{it.hint}</span> : null}
                  </span>
                  <span className="mm-cmd-row-group">{it.group}</span>
                </button>
              </li>
            ))
          )}
        </ul>
        <p className="mm-cmd-footer">Arrow keys to move, Enter to open, Escape to close</p>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(node, document.body) : null
}
