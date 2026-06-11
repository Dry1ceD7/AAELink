'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Search, Hash, MessageSquare, X, ArrowRight, Users, Command } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'

/**
 * Lightweight channel/DM type matching the page's Channel interface.
 * The QuickSwitcher receives the pre-loaded channel list from the parent
 * so it doesn't need to fetch its own data.
 */
export interface QuickSwitchChannel {
  id: string
  name: string
  display_name: string
  team_id: string
  type?: string           // 'O' | 'P' | 'D' | 'G'
  dm_peer_display?: string
}

export interface QuickSwitchUser {
  id: string
  username: string
  first_name?: string
  last_name?: string
}

/**
 * Action items — typically navigation, settings, or quick-create actions.
 * They mirror the old `CommandPaletteItem` shape so the page can move all of
 * its existing entries over without rewriting them.
 */
export interface QuickSwitchAction {
  id: string
  label: string
  hint?: string
  group?: string
  keywords?: string[]
  icon?: ReactNode
  run: () => void
}

interface Props {
  open: boolean
  onClose: () => void
  channels: QuickSwitchChannel[]
  teamMembers: QuickSwitchUser[]
  /** Optional list of action commands (Settings, navigate to module, etc.) */
  actions?: QuickSwitchAction[]
  /** Called when the user selects a channel. */
  onSelectChannel: (channel: QuickSwitchChannel) => void
  /** Called when the user selects a DM with a user. */
  onSelectDm: (userId: string) => void
  /** Current workspace ID — used for message search. */
  workspaceId: string
  /** Id of the currently-active channel, highlighted in the result list. */
  currentChannelId?: string
}

interface SearchResult {
  message_id: string
  body: string
  created_at: number
  channel_id: string
  channel_name: string
  channel_type: string
  author_username: string
  author_first_name?: string
  author_last_name?: string
}

type ResultItem =
  | { kind: 'channel'; data: QuickSwitchChannel }
  | { kind: 'user'; data: QuickSwitchUser }
  | { kind: 'message'; data: SearchResult }
  | { kind: 'action'; data: QuickSwitchAction }

function displayUser(u: QuickSwitchUser): string {
  const full = `${u.first_name || ''} ${u.last_name || ''}`.trim()
  return full || u.username
}

function channelLabel(c: QuickSwitchChannel): string {
  if (c.type === 'D') return c.dm_peer_display || c.display_name || c.name
  return c.display_name || c.name
}

function actionMatches(query: string, a: QuickSwitchAction): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return false
  const blob = [a.label, a.hint || '', a.group || '', ...(a.keywords || [])].join(' ').toLowerCase()
  return q.split(/\s+/).every(w => blob.includes(w))
}

/**
 * QuickSwitcher — Slack Cmd+K / Ctrl+K modal.
 *
 * Four-tier search:
 *   1. Actions (if any provided — Slack mixes these into the same surface)
 *   2. Channels (local fuzzy filter)
 *   3. Users/DMs (local fuzzy filter)
 *   4. Messages (API search, debounced, when query length ≥ 3)
 *
 * The QuickSwitcher absorbed the old CommandPalette as of v0.0.21-alpha
 * so users only have one Cmd+K surface to remember.
 */
export function QuickSwitcher({
  open, onClose, channels, teamMembers,
  actions, onSelectChannel, onSelectDm, workspaceId, currentChannelId
}: Props) {
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [msgResults, setMsgResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Reset on open ──────────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIdx(0)
      setMsgResults([])
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // ── Message search (debounced 400ms) ───────────────────────────────────
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (query.length < 3) { setMsgResults([]); return }

    searchTimer.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await apiFetch(
          `/api/search/messages?q=${encodeURIComponent(query)}&workspace_id=${encodeURIComponent(workspaceId)}&limit=8`
        )
        if (res.ok) {
          const data = (await res.json()) as { results: SearchResult[] }
          setMsgResults(data.results || [])
        }
      } catch { /* ignore */ }
      setSearching(false)
    }, 400)

    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [query, workspaceId])

  // ── Build unified result list ──────────────────────────────────────────
  const results: ResultItem[] = useMemo(() => {
    const q = query.toLowerCase().trim()
    const items: ResultItem[] = []

    // Actions are always shown when there is a query or when nothing else matches.
    if (actions?.length && q) {
      const matched = actions.filter(a => actionMatches(query, a)).slice(0, 6)
      matched.forEach(a => items.push({ kind: 'action', data: a }))
    }

    if (!q) {
      // Empty query → recent channels + a small subset of "navigate to" actions.
      channels.slice(0, 8).forEach(c => items.push({ kind: 'channel', data: c }))
      if (actions?.length) {
        actions
          .filter(a => a.group === 'Modules' || a.group === 'Account')
          .slice(0, 4)
          .forEach(a => items.push({ kind: 'action', data: a }))
      }
      return items
    }

    // Filter channels
    const matchedChannels = channels
      .filter(c => channelLabel(c).toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
      .slice(0, 5)
    matchedChannels.forEach(c => items.push({ kind: 'channel', data: c }))

    // Filter users
    const matchedUsers = teamMembers
      .filter(u =>
        displayUser(u).toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q)
      )
      .slice(0, 5)
    matchedUsers.forEach(u => items.push({ kind: 'user', data: u }))

    // Messages (from API)
    msgResults.forEach(m => items.push({ kind: 'message', data: m }))

    return items
  }, [query, channels, teamMembers, msgResults, actions])

  // ── Clamp selected index ───────────────────────────────────────────────
  useEffect(() => {
    setSelectedIdx(idx => Math.min(idx, Math.max(0, results.length - 1)))
  }, [results.length])

  // ── Keyboard navigation ────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = results[selectedIdx]
      if (!item) return
      if (item.kind === 'channel') {
        onSelectChannel(item.data)
        onClose()
      } else if (item.kind === 'user') {
        onSelectDm(item.data.id)
        onClose()
      } else if (item.kind === 'message') {
        const match = channels.find(c => c.id === item.data.channel_id)
        if (match) { onSelectChannel(match); onClose() }
      } else if (item.kind === 'action') {
        // Close first so the action's UI mount doesn't fight focus with us.
        onClose()
        window.queueMicrotask(() => item.data.run())
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }, [results, selectedIdx, onSelectChannel, onSelectDm, onClose, channels])

  // ── Auto-scroll selected item into view ────────────────────────────────
  useEffect(() => {
    const el = listRef.current?.children[selectedIdx] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIdx])

  if (!open) return null

  return (
    <div className="qs-overlay" role="presentation"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="qs-modal" role="dialog" aria-modal="true" aria-label="Quick switcher">
        <div className="qs-search-row">
          <Search size={18} className="qs-search-icon" />
          <input
            ref={inputRef}
            className="qs-input"
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIdx(0) }}
            onKeyDown={handleKeyDown}
            placeholder="Search channels, people, messages, or actions…"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="mm-icon-btn qs-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="qs-results" ref={listRef} role="listbox">
          {results.length === 0 && query.length >= 2 && !searching && (
            <div className="qs-empty">No results for &ldquo;{query}&rdquo;</div>
          )}

          {results.map((item, i) => {
            const isActive = i === selectedIdx
            if (item.kind === 'channel') {
              const c = item.data
              const isCurrent = !!currentChannelId && c.id === currentChannelId
              const icon = c.type === 'D'
                ? <MessageSquare size={14} className="qs-item-icon" />
                : <Hash size={14} className="qs-item-icon" />
              return (
                <button key={`ch-${c.id}`} type="button" role="option"
                  aria-selected={isActive}
                  className={`qs-item${isActive ? ' qs-item--active' : ''}${isCurrent ? ' qs-item--current-channel' : ''}`}
                  onMouseEnter={() => setSelectedIdx(i)}
                  onClick={() => { onSelectChannel(c); onClose() }}>
                  {icon}
                  <span className="qs-item-label">{channelLabel(c)}</span>
                  {isCurrent
                    ? <span className="qs-item-meta">current</span>
                    : <ArrowRight size={12} className="qs-item-go" />}
                </button>
              )
            }

            if (item.kind === 'user') {
              const u = item.data
              return (
                <button key={`u-${u.id}`} type="button" role="option"
                  aria-selected={isActive}
                  className={`qs-item${isActive ? ' qs-item--active' : ''}`}
                  onMouseEnter={() => setSelectedIdx(i)}
                  onClick={() => { onSelectDm(u.id); onClose() }}>
                  <Users size={14} className="qs-item-icon" />
                  <span className="qs-item-label">{displayUser(u)}</span>
                  <span className="qs-item-meta">@{u.username}</span>
                  <ArrowRight size={12} className="qs-item-go" />
                </button>
              )
            }

            if (item.kind === 'action') {
              const a = item.data
              return (
                <button key={`a-${a.id}`} type="button" role="option"
                  aria-selected={isActive}
                  className={`qs-item qs-item--action${isActive ? ' qs-item--active' : ''}`}
                  onMouseEnter={() => setSelectedIdx(i)}
                  onClick={() => {
                    onClose()
                    window.queueMicrotask(() => a.run())
                  }}>
                  <span className="qs-item-icon">{a.icon ?? <Command size={14} />}</span>
                  <span className="qs-item-label">{a.label}</span>
                  {a.hint ? <span className="qs-item-meta">{a.hint}</span> : null}
                  {a.group ? <span className="qs-item-group">{a.group}</span> : null}
                </button>
              )
            }

            if (item.kind === 'message') {
              const m = item.data
              const author = `${m.author_first_name || ''} ${m.author_last_name || ''}`.trim() || m.author_username
              return (
                <button key={`m-${m.message_id}`} type="button" role="option"
                  aria-selected={isActive}
                  className={`qs-item qs-item--message${isActive ? ' qs-item--active' : ''}`}
                  onMouseEnter={() => setSelectedIdx(i)}
                  onClick={() => {
                    const match = channels.find(c => c.id === m.channel_id)
                    if (match) { onSelectChannel(match); onClose() }
                  }}>
                  <div className="qs-msg-top">
                    <span className="qs-msg-channel">
                      {m.channel_type === 'D' ? '' : '#'}{m.channel_name}
                    </span>
                    <span className="qs-msg-author">{author}</span>
                  </div>
                  <div className="qs-msg-body">{m.body.slice(0, 120)}{m.body.length > 120 ? '…' : ''}</div>
                </button>
              )
            }
            return null
          })}

          {searching && (
            <div className="qs-searching">Searching messages…</div>
          )}
        </div>

        <div className="qs-footer">
          <kbd>↑↓</kbd> navigate <kbd>↵</kbd> open <kbd>esc</kbd> close
        </div>
      </div>
    </div>
  )
}
