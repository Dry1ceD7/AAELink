'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, X, Hash, MessageSquare, Loader2, User, Calendar, Paperclip, Pin, Link2, Smile, SortDesc, Clock } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import { MessageRichText } from '@/lib/messaging/messageRich'
import { parseSearchFilters, type SearchFilters } from '@/lib/messaging/searchFilters'
import { SavedSearches } from '@/components/search/SavedSearches'

interface SearchResult {
  message_id: string
  body: string
  highlight?: string
  created_at: number
  channel_id: string
  channel_name: string
  channel_type: string
  workspace_id: string
  author_id: string
  author_username: string
  author_first_name: string
  author_last_name: string
}

const FILTER_SUGGESTIONS = [
  { label: 'from:', icon: User, hint: 'Filter by author', example: 'from:username' },
  { label: 'in:', icon: Hash, hint: 'Filter by channel', example: 'in:general' },
  { label: 'before:', icon: Calendar, hint: 'Before date', example: 'before:2026-01-01' },
  { label: 'after:', icon: Calendar, hint: 'After date', example: 'after:2026-01-01' },
  { label: 'has:link', icon: Link2, hint: 'Has a link', example: 'has:link' },
  { label: 'has:file', icon: Paperclip, hint: 'Has a file or attachment', example: 'has:file' },
  { label: 'has:pin', icon: Pin, hint: 'Pinned messages', example: 'has:pin' },
  { label: 'has:reaction', icon: Smile, hint: 'Has reactions', example: 'has:reaction' },
]

interface Props {
  open: boolean
  onClose: () => void
  workspaceId: string
  onJumpToMessage?: (channelId: string, messageId: string) => void
}

// Recent searches are persisted per-workspace in localStorage so they survive a
// reload. We keep only the trimmed query text (filters are embedded in it), cap
// the list, and dedupe most-recent-first. Reads/writes are guarded so SSR and
// privacy-mode (where localStorage throws) degrade to an empty list silently.
const RECENT_KEY_PREFIX = 'aaelink:recent-searches:'
const RECENT_MAX = 8

function recentKey(workspaceId: string) {
  return `${RECENT_KEY_PREFIX}${workspaceId || 'default'}`
}

function loadRecent(workspaceId: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(recentKey(workspaceId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string').slice(0, RECENT_MAX) : []
  } catch { return [] }
}

function pushRecent(workspaceId: string, q: string): string[] {
  const trimmed = q.trim()
  const next = [trimmed, ...loadRecent(workspaceId).filter(v => v !== trimmed)].slice(0, RECENT_MAX)
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(recentKey(workspaceId), JSON.stringify(next)) } catch { /* quota or privacy mode */ }
  }
  return next
}

function clearRecent(workspaceId: string) {
  if (typeof window !== 'undefined') {
    try { window.localStorage.removeItem(recentKey(workspaceId)) } catch { /* privacy mode */ }
  }
}

export function GlobalSearchModal({ open, onClose, workspaceId, onJumpToMessage }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(-1)
  const [sort, setSort] = useState<'relevance' | 'recent'>('relevance')
  const [recent, setRecent] = useState<string[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const filters = useMemo(() => parseSearchFilters(query), [query])
  const activeFilterKeys = useMemo(() => {
    const keys: string[] = []
    if (filters.from) keys.push('from')
    if (filters.in) keys.push('in')
    if (filters.before) keys.push('before')
    if (filters.after) keys.push('after')
    if (filters.on) keys.push('on')
    if (filters.during) keys.push('during')
    if (filters.has) keys.push('has')
    if (filters.is?.length) keys.push('is')
    return keys
  }, [filters])

  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      setTotal(0)
      setSearched(false)
      setSelectedIdx(-1)
      setSort('relevance')
      setRecent(loadRecent(workspaceId))
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open, workspaceId])

  const doSearch = useCallback(async (q: string) => {
    const parsed = parseSearchFilters(q)
    // The FTS engine needs >= 2 chars of keyword text; filter-only queries can't
    // run on their own, so require real text before firing.
    if (parsed.text.length < 2) {
      setResults([]); setTotal(0); setSearched(false); return
    }
    setLoading(true)
    setSearched(true)
    const params = new URLSearchParams({ q: parsed.text, limit: '25' })
    if (workspaceId) params.set('workspace_id', workspaceId)
    params.set('sort', sort)
    if (parsed.from) params.set('from', parsed.from)
    // in:<name> resolves server-side against readable channels (channel_name),
    // not the opaque channel_id the old path mistakenly sent.
    if (parsed.in) params.set('channel_name', parsed.in)
    if (parsed.before) params.set('before', parsed.before)
    if (parsed.after) params.set('after', parsed.after)
    if (parsed.on) params.set('on', parsed.on)
    if (parsed.during) params.set('during', parsed.during)
    if (parsed.has) params.set('has', parsed.has)
    for (const flag of parsed.is ?? []) params.append('is', flag)
    const res = await apiFetch(`/api/search/messages?${params.toString()}`)
    setLoading(false)
    if (res.ok) {
      const data = (await res.json()) as { results: SearchResult[]; total: number }
      setResults(data.results)
      setTotal(data.total)
      // Record the issued query so the user can re-run it later. We persist the
      // full raw query (text + filters) rather than just parsed.text so a saved
      // recent re-applies the exact filter set the user typed.
      if (data.results.length > 0) setRecent(pushRecent(workspaceId, q))
    }
  }, [workspaceId, sort])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void doSearch(query), 350)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, doSearch])

  // Keep the keyboard-selected result visible while arrowing through a long
  // list. We address the row by its index data attribute rather than holding a
  // ref per row, so this stays O(1) and never grows with result count.
  useEffect(() => {
    if (selectedIdx < 0 || !resultsRef.current) return
    const el = resultsRef.current.querySelector<HTMLElement>(`[data-result-idx="${selectedIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIdx])

  const removeFilter = useCallback((key: string) => {
    setQuery(prev => {
      const re = new RegExp(`\\b${key}:\\S+`, 'gi')
      return prev.replace(re, '').replace(/\s+/g, ' ').trim()
    })
  }, [])

  const addFilter = useCallback((label: string) => {
    setQuery(prev => `${prev} ${label}`.trim())
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus()
        inputRef.current.setSelectionRange(inputRef.current.value.length, inputRef.current.value.length)
      }
    }, 10)
  }, [])

  if (!open || typeof document === 'undefined') return null

  function fmtTime(ts: number) {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })
  }

  function authorName(r: SearchResult) {
    const full = `${r.author_first_name || ''} ${r.author_last_name || ''}`.trim()
    return full || r.author_username
  }

  // Render the server-side ts_headline highlight. The engine returns a string
  // with <mark>…</mark> around matched (stemmed) tokens; we split on those tags
  // and render the marked spans as <mark>, the rest as plain text. We never use
  // dangerouslySetInnerHTML — only the literal <mark> markers are interpreted,
  // so message content can't inject markup.
  function renderServerHighlight(highlight: string) {
    const parts: React.ReactNode[] = []
    const re = /<mark>([\s\S]*?)<\/mark>/g
    let cursor = 0
    let key = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(highlight)) !== null) {
      if (m.index > cursor) parts.push(<span key={key++}>{highlight.slice(cursor, m.index)}</span>)
      parts.push(<mark key={key++} className="search-highlight">{m[1]}</mark>)
      cursor = m.index + m[0].length
    }
    if (cursor < highlight.length) parts.push(<span key={key++}>{highlight.slice(cursor)}</span>)
    return <span className="search-result-text">{parts}</span>
  }

  function highlightBody(r: SearchResult) {
    // Prefer the server highlight (tracks FTS/stemmed matches like running→run).
    if (r.highlight && r.highlight.includes('<mark>')) return renderServerHighlight(r.highlight)
    const body = r.body
    const q = filters.text
    if (!q || q.length < 2) return <MessageRichText text={body.slice(0, 200)} />
    const lower = body.toLowerCase()
    const qLower = q.toLowerCase()
    const idx = lower.indexOf(qLower)
    if (idx === -1) return <MessageRichText text={body.slice(0, 200)} />
    const start = Math.max(0, idx - 60)
    const end = Math.min(body.length, idx + q.length + 100)
    const snippet = (start > 0 ? '…' : '') + body.slice(start, end) + (end < body.length ? '…' : '')

    const parts: React.ReactNode[] = []
    const snipLower = snippet.toLowerCase()
    let cursor = 0
    let matchIdx = snipLower.indexOf(qLower, cursor)
    let key = 0
    while (matchIdx !== -1) {
      if (matchIdx > cursor) {
        parts.push(<span key={key++}>{snippet.slice(cursor, matchIdx)}</span>)
      }
      parts.push(
        <mark key={key++} className="search-highlight">{snippet.slice(matchIdx, matchIdx + q.length)}</mark>
      )
      cursor = matchIdx + q.length
      matchIdx = snipLower.indexOf(qLower, cursor)
    }
    if (cursor < snippet.length) {
      parts.push(<span key={key++}>{snippet.slice(cursor)}</span>)
    }
    return <span className="search-result-text">{parts}</span>
  }

  const hasIconMap: Record<string, typeof Paperclip> = {
    file: Paperclip, attachment: Paperclip,
    pin: Pin, link: Link2, reaction: Smile
  }

  return createPortal(
    <div className="mm-modal-overlay" role="presentation"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="global-search-modal" role="dialog" aria-modal="true" aria-label="Search messages"
        onClick={e => e.stopPropagation()}>
        {/* Search bar */}
        <div className="global-search-bar">
          <Search size={18} className="global-search-icon" />
          <input
            ref={inputRef}
            type="search"
            className="global-search-input"
            placeholder="Search messages… (try from:user in:channel has:file)"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') { onClose(); return }
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSelectedIdx(i => Math.min(i + 1, results.length - 1))
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSelectedIdx(i => Math.max(i - 1, -1))
                return
              }
              if (e.key === 'Enter' && selectedIdx >= 0 && results[selectedIdx]) {
                e.preventDefault()
                const r = results[selectedIdx]
                onJumpToMessage?.(r.channel_id, r.message_id)
                onClose()
                return
              }
            }}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="mm-icon-btn" onClick={onClose} aria-label="Close search">
            <X size={18} />
          </button>
        </div>

        {/* Active filter pills */}
        {activeFilterKeys.length > 0 && (
          <div className="search-filter-pills" role="list" aria-label="Active search filters">
            {activeFilterKeys.map(key => {
              const rawVal = filters[key as keyof SearchFilters]
              const val = Array.isArray(rawVal) ? rawVal.join(', ') : String(rawVal ?? '')
              const HasIcon = key === 'has' ? (hasIconMap[val] || Paperclip) :
                key === 'from' ? User :
                key === 'in' ? Hash :
                key === 'is' ? Pin :
                Calendar
              return (
                <span key={key} className="search-filter-pill" role="listitem">
                  <HasIcon size={12} aria-hidden="true" />
                  <span className="search-filter-pill-label">{key}:</span>
                  <span className="search-filter-pill-value">{val}</span>
                  <button type="button" className="search-filter-pill-remove"
                    aria-label={`Remove ${key} filter`}
                    onClick={() => removeFilter(key)}>
                    <X size={10} />
                  </button>
                </span>
              )
            })}
          </div>
        )}

        {/* Filter suggestions (when empty or not yet searched) */}
        {!searched && query.length < 2 && (
          <div className="search-filter-suggestions">
            <span className="search-filter-suggestions-label">Filter by:</span>
            {FILTER_SUGGESTIONS.map(s => (
              <button key={s.label} type="button" className="search-filter-suggestion"
                title={s.hint}
                onClick={() => addFilter(s.label)}>
                <s.icon size={13} aria-hidden="true" />
                {s.label}
              </button>
            ))}
          </div>
        )}

        {/* Recent searches (only before an active search, when there's history) */}
        {!searched && query.length < 2 && recent.length > 0 && (
          <div className="search-recent" aria-label="Recent searches"
            style={{ padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="search-recent-head"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="search-recent-label"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--mm-muted)' }}>
                <Clock size={12} aria-hidden="true" /> Recent
              </span>
              <button
                type="button"
                className="search-recent-clear"
                onClick={() => { clearRecent(workspaceId); setRecent([]) }}
                aria-label="Clear recent searches"
                style={{ fontSize: 11, color: 'var(--mm-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                Clear
              </button>
            </div>
            <div className="search-recent-list" role="list"
              style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {recent.map(r => (
                <button
                  key={r}
                  type="button"
                  className="search-recent-item"
                  role="listitem"
                  title={r}
                  onClick={() => {
                    setQuery(r)
                    setTimeout(() => inputRef.current?.focus(), 10)
                  }}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    maxWidth: 220, padding: '3px 8px', borderRadius: 12,
                    border: '1px solid var(--mm-border)', background: 'var(--mm-bg-elev, transparent)',
                    fontSize: 12, color: 'var(--mm-text)', cursor: 'pointer',
                  }}
                >
                  <Clock size={11} aria-hidden="true" />
                  <span className="search-recent-item-text"
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Saved searches */}
        <SavedSearches
          workspaceId={workspaceId}
          open={open}
          currentQuery={query}
          currentFilters={filters as unknown as Record<string, unknown>}
          onApply={q => { setQuery(q); setTimeout(() => inputRef.current?.focus(), 10) }}
        />

        {/* Results */}
        <div className="global-search-results" ref={resultsRef}>
          {loading && (
            <div className="global-search-status">
              <Loader2 size={20} className="spin" /> Searching…
            </div>
          )}

          {!loading && searched && results.length === 0 && (
            <div className="global-search-status">
              <MessageSquare size={24} strokeWidth={1.5} />
              <p>No messages found matching &quot;{filters.text || query}&quot;</p>
            </div>
          )}

          {!loading && results.length > 0 && (
            <>
              <div className="global-search-count">
                <span>
                  {total} result{total !== 1 ? 's' : ''} found
                  {activeFilterKeys.length > 0 && (
                    <span style={{ color: 'var(--mm-muted)', marginLeft: 6, fontSize: 12 }}>
                      ({activeFilterKeys.map(k => {
                        const v = filters[k as keyof SearchFilters]
                        return `${k}:${Array.isArray(v) ? v.join('+') : v}`
                      }).join(', ')})
                    </span>
                  )}
                </span>
                <div className="global-search-sort" role="group" aria-label="Sort results">
                  <button
                    type="button"
                    className={`global-search-sort-btn${sort === 'relevance' ? ' global-search-sort-btn--active' : ''}`}
                    aria-pressed={sort === 'relevance'}
                    onClick={() => setSort('relevance')}
                    title="Sort by relevance"
                  >
                    <SortDesc size={13} aria-hidden="true" /> Relevance
                  </button>
                  <button
                    type="button"
                    className={`global-search-sort-btn${sort === 'recent' ? ' global-search-sort-btn--active' : ''}`}
                    aria-pressed={sort === 'recent'}
                    onClick={() => setSort('recent')}
                    title="Sort by most recent"
                  >
                    <Clock size={13} aria-hidden="true" /> Recent
                  </button>
                </div>
              </div>
              {results.map((r, idx) => (
                <button
                  key={r.message_id}
                  type="button"
                  data-result-idx={idx}
                  className={`global-search-result${idx === selectedIdx ? ' global-search-result--active' : ''}`}
                  onClick={() => {
                    onJumpToMessage?.(r.channel_id, r.message_id)
                    onClose()
                  }}>
                  <div className="global-search-result-header">
                    <strong className="global-search-author">{authorName(r)}</strong>
                    <span className="global-search-channel">
                      <Hash size={12} />
                      {r.channel_name}
                    </span>
                    <span className="global-search-time">{fmtTime(r.created_at)}</span>
                  </div>
                  <div className="global-search-result-body">
                    {highlightBody(r)}
                  </div>
                </button>
              ))}
            </>
          )}

          {!loading && !searched && query.length >= 2 && (
            <div className="global-search-status">
              <Search size={28} strokeWidth={1.5} />
              <p>Press Enter or wait to search</p>
            </div>
          )}

          {!loading && !searched && query.length < 2 && (
            <div className="global-search-status">
              <Search size={28} strokeWidth={1.5} />
              <p>Search across all your messages and channels</p>
              <span style={{ fontSize: 12, color: 'var(--mm-muted)' }}>Type at least 2 characters or use filters to start</span>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
