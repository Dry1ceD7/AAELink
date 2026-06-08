'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, X, Hash, MessageSquare, Loader2, User, Calendar, Paperclip, Pin, Link2, Smile, SortDesc, Clock, FileText, Users, Bookmark, AtSign } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import { MessageRichText } from '@/lib/messaging/messageRich'
import { parseSearchFilters, type SearchFilters } from '@/lib/messaging/searchFilters'
import { SavedSearches } from '@/components/search/SavedSearches'
import { FilePreviewModal } from '@/components/media/FilePreviewModal'

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

// Shape returned by /api/search/all and /api/search/files (file_index rows).
interface FileResult {
  id: string
  file_id: string
  filename: string
  file_type: string
  channel_id: string
  uploaded_by: string
  uploaded_by_username: string
  indexed_at: number
  content_length: number
  highlights?: string
}

// Shape returned by /api/search/all and /api/search/users (enriched users).
interface PersonResult {
  id: string
  username: string
  first_name: string
  last_name: string
  email: string
  avatar_url: string | null
  job_title: string | null
  department: string | null
  presence_status: string | null
}

type Facet = 'all' | 'messages' | 'files' | 'people'

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

// Quick filter chips appended to the query on click. Each maps to a filter
// token the existing parseSearchFilters() understands, so the active-pill UI
// and the message-search endpoint both pick them up with no extra wiring.
const FILTER_CHIPS = [
  { label: 'has:attachment', token: 'has:file', icon: Paperclip },
  { label: 'is:thread', token: 'is:thread', icon: MessageSquare },
  { label: 'is:pinned', token: 'is:pinned', icon: Pin },
  { label: 'is:saved', token: 'is:saved', icon: Bookmark },
  { label: 'is:dm', token: 'is:dm', icon: AtSign },
]

interface Props {
  open: boolean
  onClose: () => void
  workspaceId: string
  onJumpToMessage?: (channelId: string, messageId: string) => void
  onOpenProfile?: (userId: string) => void
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

function fmtBytes(n: number): string {
  if (!n || n < 1024) return `${n || 0} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let val = n / 1024
  let i = 0
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++ }
  return `${val.toFixed(val >= 10 ? 0 : 1)} ${units[i]}`
}

// Render a server ts_headline highlight string (<mark>…</mark> markers) without
// dangerouslySetInnerHTML — only the literal <mark> markers are interpreted, so
// content can't inject markup.
function renderHighlight(highlight: string) {
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

export function GlobalSearchModal({ open, onClose, workspaceId, onJumpToMessage, onOpenProfile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [files, setFiles] = useState<FileResult[]>([])
  const [people, setPeople] = useState<PersonResult[]>([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState({ messages: 0, files: 0, people: 0 })
  const [facet, setFacet] = useState<Facet>('all')
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(-1)
  const [sort, setSort] = useState<'relevance' | 'recent'>('relevance')
  const [recent, setRecent] = useState<string[]>([])
  const [preview, setPreview] = useState<{ url: string; filename: string; mimeType?: string } | null>(null)
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
      setFiles([])
      setPeople([])
      setTotal(0)
      setCounts({ messages: 0, files: 0, people: 0 })
      setFacet('all')
      setSearched(false)
      setSelectedIdx(-1)
      setSort('relevance')
      setPreview(null)
      setRecent(loadRecent(workspaceId))
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open, workspaceId])

  const doSearch = useCallback(async (q: string) => {
    const parsed = parseSearchFilters(q)
    // The FTS engine needs >= 2 chars of keyword text; filter-only queries can't
    // run on their own, so require real text before firing.
    if (parsed.text.length < 2) {
      setResults([]); setFiles([]); setPeople([]); setTotal(0)
      setCounts({ messages: 0, files: 0, people: 0 }); setSearched(false); return
    }
    setLoading(true)
    setSearched(true)

    // Message search keeps the full filter + sort surface via /search/messages
    // (the rich, paginated message endpoint). Files + people come from the
    // combined /search/all facet endpoint, whose item shapes mirror the
    // standalone /search/files and /search/users routes.
    const msgParams = new URLSearchParams({ q: parsed.text, limit: '25' })
    if (workspaceId) msgParams.set('workspace_id', workspaceId)
    msgParams.set('sort', sort)
    if (parsed.from) msgParams.set('from', parsed.from)
    // in:<name> resolves server-side against readable channels (channel_name),
    // not the opaque channel_id the old path mistakenly sent.
    if (parsed.in) msgParams.set('channel_name', parsed.in)
    if (parsed.before) msgParams.set('before', parsed.before)
    if (parsed.after) msgParams.set('after', parsed.after)
    if (parsed.on) msgParams.set('on', parsed.on)
    if (parsed.during) msgParams.set('during', parsed.during)
    if (parsed.has) msgParams.set('has', parsed.has)
    for (const flag of parsed.is ?? []) msgParams.append('is', flag)

    const allParams = new URLSearchParams({ q: parsed.text, limit: '25' })
    if (workspaceId) allParams.set('workspace_id', workspaceId)

    const [msgRes, allRes] = await Promise.all([
      apiFetch(`/api/search/messages?${msgParams.toString()}`),
      apiFetch(`/api/search/all?${allParams.toString()}`),
    ])
    setLoading(false)

    let msgTotal = 0
    let msgCount = 0
    if (msgRes.ok) {
      const data = (await msgRes.json()) as { results: SearchResult[]; total: number }
      setResults(data.results)
      setTotal(data.total)
      msgTotal = data.total
      msgCount = data.results.length
    }

    if (allRes.ok) {
      const data = (await allRes.json()) as {
        files: FileResult[]
        people: PersonResult[]
        counts: { messages: number; files: number; people: number }
      }
      setFiles(data.files || [])
      setPeople(data.people || [])
      // Prefer the dedicated message total/count from /search/messages (full
      // result set) over the /search/all facet count (capped per-facet).
      setCounts({
        messages: msgCount || data.counts.messages,
        files: data.counts.files,
        people: data.counts.people,
      })
    }

    // Record the issued query so the user can re-run it later. We persist the
    // full raw query (text + filters) rather than just parsed.text so a saved
    // recent re-applies the exact filter set the user typed.
    if (msgTotal > 0) setRecent(pushRecent(workspaceId, q))
  }, [workspaceId, sort])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void doSearch(query), 350)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, doSearch])

  // Reset the keyboard cursor whenever the active facet changes so arrowing
  // always starts from the top of the visible list.
  useEffect(() => { setSelectedIdx(-1) }, [facet])

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

  // A chip is "active" when its token already lives in the query string.
  const toggleChip = useCallback((token: string) => {
    setQuery(prev => {
      const re = new RegExp(`\\b${token.replace(':', ':\\s*')}\\b`, 'i')
      if (re.test(prev)) return prev.replace(re, '').replace(/\s+/g, ' ').trim()
      return `${prev} ${token}`.trim()
    })
    setTimeout(() => inputRef.current?.focus(), 10)
  }, [])

  const openFile = useCallback((f: FileResult) => {
    setPreview({
      url: `/api/files/${f.file_id}/download`,
      filename: f.filename || 'file',
      mimeType: f.file_type || undefined,
    })
  }, [])

  const openPerson = useCallback((p: PersonResult) => {
    if (onOpenProfile) { onOpenProfile(p.id); onClose() }
  }, [onOpenProfile, onClose])

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

  function personName(p: PersonResult) {
    const full = `${p.first_name || ''} ${p.last_name || ''}`.trim()
    return full || p.username
  }

  function personInitials(p: PersonResult) {
    const a = (p.first_name || p.username || '?').charAt(0)
    const b = (p.last_name || '').charAt(0)
    return `${a}${b}`.toUpperCase()
  }

  function highlightBody(r: SearchResult) {
    // Prefer the server highlight (tracks FTS/stemmed matches like running→run).
    if (r.highlight && r.highlight.includes('<mark>')) return renderHighlight(r.highlight)
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

  const totalCount = counts.messages + counts.files + counts.people
  const showMessages = facet === 'all' || facet === 'messages'
  const showFiles = facet === 'all' || facet === 'files'
  const showPeople = facet === 'all' || facet === 'people'

  const FACET_TABS: { key: Facet; label: string; icon: typeof Search; count: number }[] = [
    { key: 'all', label: 'All', icon: Search, count: totalCount },
    { key: 'messages', label: 'Messages', icon: MessageSquare, count: counts.messages },
    { key: 'files', label: 'Files', icon: FileText, count: counts.files },
    { key: 'people', label: 'People', icon: Users, count: counts.people },
  ]

  function presenceClass(status: string | null) {
    const s = (status || '').toLowerCase()
    if (s === 'online' || s === 'active') return 'search-presence--online'
    if (s === 'away' || s === 'idle') return 'search-presence--away'
    if (s === 'dnd' || s === 'busy') return 'search-presence--dnd'
    return 'search-presence--offline'
  }

  return createPortal(
    <div className="mm-modal-overlay" role="presentation"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="global-search-modal" role="dialog" aria-modal="true" aria-label="Search"
        onClick={e => e.stopPropagation()}>
        {/* Search bar */}
        <div className="global-search-bar">
          <Search size={18} className="global-search-icon" />
          <input
            ref={inputRef}
            type="search"
            className="global-search-input"
            placeholder="Search messages, files, people… (try from:user in:channel has:file)"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') { onClose(); return }
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                const max = showMessages && facet === 'messages' ? results.length
                  : facet === 'files' ? files.length
                  : facet === 'people' ? people.length
                  : results.length
                setSelectedIdx(i => Math.min(i + 1, max - 1))
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSelectedIdx(i => Math.max(i - 1, -1))
                return
              }
              if (e.key === 'Enter' && selectedIdx >= 0) {
                if (facet === 'files' && files[selectedIdx]) {
                  e.preventDefault(); openFile(files[selectedIdx]); return
                }
                if (facet === 'people' && people[selectedIdx]) {
                  e.preventDefault(); openPerson(people[selectedIdx]); return
                }
                if (results[selectedIdx]) {
                  e.preventDefault()
                  const r = results[selectedIdx]
                  onJumpToMessage?.(r.channel_id, r.message_id)
                  onClose()
                  return
                }
              }
            }}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="mm-icon-btn" onClick={onClose} aria-label="Close search">
            <X size={18} />
          </button>
        </div>

        {/* Facet tabs */}
        {searched && (
          <div className="global-search-tabs" role="tablist" aria-label="Search categories">
            {FACET_TABS.map(t => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={facet === t.key}
                className={`global-search-tab${facet === t.key ? ' global-search-tab--active' : ''}`}
                onClick={() => setFacet(t.key)}
              >
                <t.icon size={14} aria-hidden="true" />
                <span>{t.label}</span>
                <span className="global-search-tab-count">{t.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Quick filter chips */}
        <div className="search-filter-chips" role="group" aria-label="Quick filters">
          {FILTER_CHIPS.map(chip => {
            const re = new RegExp(`\\b${chip.token.replace(':', ':\\s*')}\\b`, 'i')
            const active = re.test(query)
            return (
              <button
                key={chip.label}
                type="button"
                className={`search-filter-chip${active ? ' search-filter-chip--active' : ''}`}
                aria-pressed={active}
                onClick={() => toggleChip(chip.token)}
              >
                <chip.icon size={12} aria-hidden="true" />
                {chip.label}
              </button>
            )
          })}
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

          {!loading && searched && totalCount === 0 && (
            <div className="global-search-status">
              <MessageSquare size={24} strokeWidth={1.5} />
              <p>No results found matching &quot;{filters.text || query}&quot;</p>
            </div>
          )}

          {!loading && totalCount > 0 && (
            <>
              {/* Messages facet */}
              {showMessages && results.length > 0 && (
                <>
                  <div className="global-search-count">
                    <span>
                      {facet === 'messages' ? total : counts.messages} message{(facet === 'messages' ? total : counts.messages) !== 1 ? 's' : ''}
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
                      data-result-idx={facet === 'messages' ? idx : undefined}
                      className={`global-search-result${facet === 'messages' && idx === selectedIdx ? ' global-search-result--active' : ''}`}
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

              {/* Files facet */}
              {showFiles && files.length > 0 && (
                <>
                  {facet === 'all' && <div className="global-search-section-head"><FileText size={13} aria-hidden="true" /> Files</div>}
                  {facet === 'files' && <div className="global-search-count"><span>{counts.files} file{counts.files !== 1 ? 's' : ''}</span></div>}
                  {files.map((f, idx) => (
                    <button
                      key={f.id}
                      type="button"
                      data-result-idx={facet === 'files' ? idx : undefined}
                      className={`global-search-result global-search-file${facet === 'files' && idx === selectedIdx ? ' global-search-result--active' : ''}`}
                      onClick={() => openFile(f)}>
                      <div className="global-search-result-header">
                        <FileText size={14} aria-hidden="true" />
                        <strong className="global-search-author">{f.filename || 'Untitled file'}</strong>
                        {f.file_type && <span className="global-search-file-type">{f.file_type}</span>}
                        <span className="global-search-file-size">{fmtBytes(f.content_length)}</span>
                        <span className="global-search-time">{fmtTime(f.indexed_at)}</span>
                      </div>
                      <div className="global-search-result-body">
                        {f.highlights && f.highlights.includes('<mark>')
                          ? renderHighlight(f.highlights)
                          : <span className="search-result-text" style={{ color: 'var(--mm-muted)' }}>
                              {f.uploaded_by_username ? `Uploaded by ${f.uploaded_by_username}` : 'File'}
                            </span>}
                      </div>
                    </button>
                  ))}
                </>
              )}

              {/* People facet */}
              {showPeople && people.length > 0 && (
                <>
                  {facet === 'all' && <div className="global-search-section-head"><Users size={13} aria-hidden="true" /> People</div>}
                  {facet === 'people' && <div className="global-search-count"><span>{counts.people} {counts.people !== 1 ? 'people' : 'person'}</span></div>}
                  {people.map((p, idx) => (
                    <button
                      key={p.id}
                      type="button"
                      data-result-idx={facet === 'people' ? idx : undefined}
                      className={`global-search-result global-search-person${facet === 'people' && idx === selectedIdx ? ' global-search-result--active' : ''}`}
                      onClick={() => openPerson(p)}>
                      <div className="global-search-person-row">
                        <span className="global-search-avatar">
                          {p.avatar_url
                            ? <img src={p.avatar_url} alt="" className="global-search-avatar-img" />
                            : <span className="global-search-avatar-fallback">{personInitials(p)}</span>}
                          <span className={`search-presence-dot ${presenceClass(p.presence_status)}`} aria-hidden="true" />
                        </span>
                        <span className="global-search-person-meta">
                          <strong className="global-search-author">{personName(p)}</strong>
                          <span className="global-search-person-handle">@{p.username}</span>
                          {(p.job_title || p.department) && (
                            <span className="global-search-person-sub">
                              {[p.job_title, p.department].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </span>
                      </div>
                    </button>
                  ))}
                </>
              )}
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
              <p>Search across all your messages, files, and people</p>
              <span style={{ fontSize: 12, color: 'var(--mm-muted)' }}>Type at least 2 characters or use filters to start</span>
            </div>
          )}
        </div>
      </div>

      {preview && (
        <FilePreviewModal
          url={preview.url}
          filename={preview.filename}
          mimeType={preview.mimeType}
          onClose={() => setPreview(null)}
        />
      )}
    </div>,
    document.body
  )
}
