'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, X, Hash, MessageSquare, Loader2, User, Calendar, Paperclip, Pin, Link2, Smile } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import { MessageRichText } from '@/lib/messaging/messageRich'
import { parseSearchFilters, type SearchFilters } from '@/lib/messaging/searchFilters'

interface SearchResult {
  message_id: string
  body: string
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

export function GlobalSearchModal({ open, onClose, workspaceId, onJumpToMessage }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const filters = useMemo(() => parseSearchFilters(query), [query])
  const activeFilterKeys = useMemo(() => {
    const keys: string[] = []
    if (filters.from) keys.push('from')
    if (filters.in) keys.push('in')
    if (filters.before) keys.push('before')
    if (filters.after) keys.push('after')
    if (filters.has) keys.push('has')
    return keys
  }, [filters])

  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      setTotal(0)
      setSearched(false)
      setSelectedIdx(-1)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const doSearch = useCallback(async (q: string) => {
    const parsed = parseSearchFilters(q)
    if (parsed.text.length < 2 && !parsed.from && !parsed.in && !parsed.has) {
      setResults([]); setTotal(0); setSearched(false); return
    }
    setLoading(true)
    setSearched(true)
    const params = new URLSearchParams({ q: parsed.text || '*', limit: '25' })
    if (workspaceId) params.set('workspace_id', workspaceId)
    if (parsed.from) params.set('from', parsed.from)
    if (parsed.in) params.set('channel_id', parsed.in)
    if (parsed.before) params.set('before', parsed.before)
    if (parsed.after) params.set('after', parsed.after)
    if (parsed.has) params.set('has', parsed.has)
    const res = await apiFetch(`/api/search/messages?${params.toString()}`)
    setLoading(false)
    if (res.ok) {
      const data = (await res.json()) as { results: SearchResult[]; total: number }
      setResults(data.results)
      setTotal(data.total)
    }
  }, [workspaceId])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void doSearch(query), 350)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, doSearch])

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

  function highlightBody(body: string) {
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
              const val = filters[key as keyof SearchFilters] as string
              const HasIcon = key === 'has' ? (hasIconMap[val] || Paperclip) :
                key === 'from' ? User :
                key === 'in' ? Hash :
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

        {/* Results */}
        <div className="global-search-results">
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
                {total} result{total !== 1 ? 's' : ''} found
                {activeFilterKeys.length > 0 && (
                  <span style={{ color: 'var(--mm-muted)', marginLeft: 6, fontSize: 12 }}>
                    ({activeFilterKeys.map(k => `${k}:${filters[k as keyof SearchFilters]}`).join(', ')})
                  </span>
                )}
              </div>
              {results.map((r, idx) => (
                <button
                  key={r.message_id}
                  type="button"
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
                    {highlightBody(r.body)}
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
