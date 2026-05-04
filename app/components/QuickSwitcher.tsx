'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, Hash, MessageSquare, X, ArrowRight, Users } from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'

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

interface Props {
  open: boolean
  onClose: () => void
  channels: QuickSwitchChannel[]
  teamMembers: QuickSwitchUser[]
  /** Called when the user selects a channel. */
  onSelectChannel: (channel: QuickSwitchChannel) => void
  /** Called when the user selects a DM with a user. */
  onSelectDm: (userId: string) => void
  /** Current workspace ID — used for message search. */
  workspaceId: string
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

function displayUser(u: QuickSwitchUser): string {
  const full = `${u.first_name || ''} ${u.last_name || ''}`.trim()
  return full || u.username
}

function channelLabel(c: QuickSwitchChannel): string {
  if (c.type === 'D') return c.dm_peer_display || c.display_name || c.name
  return c.display_name || c.name
}

/**
 * QuickSwitcher — Slack Cmd+K / Ctrl+K modal.
 *
 * Three-tier search:
 *   1. Channels (local fuzzy filter)
 *   2. Users/DMs (local fuzzy filter)
 *   3. Messages (API search, debounced, when query length ≥ 3)
 */
export function QuickSwitcher({
  open, onClose, channels, teamMembers,
  onSelectChannel, onSelectDm, workspaceId
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

    if (!q) {
      // Show recent / all channels when empty
      channels.slice(0, 8).forEach(c =>
        items.push({ kind: 'channel', data: c })
      )
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
  }, [query, channels, teamMembers, msgResults])

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
            placeholder="Search channels, people, or messages…"
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
              const icon = c.type === 'D'
                ? <MessageSquare size={14} className="qs-item-icon" />
                : <Hash size={14} className="qs-item-icon" />
              return (
                <button key={`ch-${c.id}`} type="button" role="option"
                  aria-selected={isActive}
                  className={`qs-item${isActive ? ' qs-item--active' : ''}`}
                  onMouseEnter={() => setSelectedIdx(i)}
                  onClick={() => { onSelectChannel(c); onClose() }}>
                  {icon}
                  <span className="qs-item-label">{channelLabel(c)}</span>
                  <ArrowRight size={12} className="qs-item-go" />
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
