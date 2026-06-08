'use client'

import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, X, MessageCircle } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'

interface SearchHit {
  id: string
  channel_id: string
  channel_name: string
  channel_display: string
  channel_type: string
  snippet: string
  /** Server-side ts_headline highlight (<mark>…</mark>), present since the FTS engine. */
  highlight?: string
  created_at: number
}

/**
 * Render the server-side ts_headline highlight. The engine returns a string with
 * <mark>…</mark> around matched (stemmed) tokens; we split on those tags and
 * render the marked spans as <mark>, the rest as plain text. We never use
 * dangerouslySetInnerHTML — only the literal <mark> markers are interpreted, so
 * message content can't inject markup. Falls back to the plain snippet.
 */
function renderHit(hit: SearchHit) {
  const h = hit.highlight
  if (!h || !h.includes('<mark>')) return hit.snippet
  const parts: React.ReactNode[] = []
  const re = /<mark>([\s\S]*?)<\/mark>/g
  let cursor = 0
  let key = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(h)) !== null) {
    if (m.index > cursor) parts.push(<span key={key++}>{h.slice(cursor, m.index)}</span>)
    parts.push(<mark key={key++} className="mm-search-highlight">{m[1]}</mark>)
    cursor = m.index + m[0].length
  }
  if (cursor < h.length) parts.push(<span key={key++}>{h.slice(cursor)}</span>)
  return <>{parts}</>
}

interface SearchPanelProps {
  open: boolean
  onClose: () => void
  workspaceId: string
  /** Called when the user clicks a search result. */
  onPick: (hit: SearchHit) => void
}

const DEBOUNCE_MS = 350

export function SearchPanel({ open, onClose, workspaceId, onPick }: SearchPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(-1)
  const abortRef = useRef<AbortController | null>(null)

  // Focus input when opened
  useEffect(() => {
    if (!open) { setQuery(''); setHits([]); setSearched(false); setSelectedIdx(-1); return }
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open])

  // Reset the keyboard selection whenever the result set changes so a stale
  // index can never point past the end of the new list.
  useEffect(() => { setSelectedIdx(-1) }, [hits])

  // Keep the keyboard-selected hit scrolled into view while arrowing.
  useEffect(() => {
    if (selectedIdx < 0 || !resultsRef.current) return
    const el = resultsRef.current.querySelector<HTMLElement>(`[data-hit-idx="${selectedIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIdx])

  // Escape to close
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  // Debounced search
  useEffect(() => {
    const q = query.trim()
    if (!q || !workspaceId) { setHits([]); setSearched(false); return }
    const timer = setTimeout(async () => {
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setLoading(true)
      try {
        const params = new URLSearchParams({ workspace_id: workspaceId, q })
        const res = await apiFetch(`/api/messages/search?${params}`, {
          method: 'GET',
          signal: ctrl.signal
        })
        if (res.ok && !ctrl.signal.aborted) {
          const data = (await res.json()) as { hits?: SearchHit[] }
          setHits(data.hits ?? [])
          setSearched(true)
        }
      } catch {
        /* aborted or network error */
      } finally {
        if (!ctrl.signal.aborted) setLoading(false)
      }
    }, DEBOUNCE_MS)
    return () => { clearTimeout(timer); abortRef.current?.abort() }
  }, [query, workspaceId])

  const handlePick = useCallback(
    (hit: SearchHit) => {
      onPick(hit)
      onClose()
    },
    [onPick, onClose]
  )

  if (!open) return null

  const panel = (
    <div className="mm-search-overlay" role="presentation" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mm-search-panel" role="dialog" aria-modal="true" aria-label="Search messages"
        onClick={e => e.stopPropagation()}>
        <div className="mm-search-header">
          <Search size={18} className="mm-search-icon" aria-hidden />
          <input
            ref={inputRef}
            type="search"
            className="mm-search-input"
            placeholder="Search messages…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSelectedIdx(i => Math.min(i + 1, hits.length - 1))
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSelectedIdx(i => Math.max(i - 1, -1))
                return
              }
              if (e.key === 'Enter' && selectedIdx >= 0 && hits[selectedIdx]) {
                e.preventDefault()
                handlePick(hits[selectedIdx])
              }
            }}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="mm-search-close" onClick={onClose} aria-label="Close search">
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="mm-search-results" ref={resultsRef}>
          {loading && <p className="mm-search-status">Searching…</p>}
          {!loading && searched && hits.length === 0 && (
            <p className="mm-search-status">No messages found for &ldquo;{query.trim()}&rdquo;</p>
          )}
          {hits.map((hit, idx) => (
            <button
              key={hit.id}
              type="button"
              data-hit-idx={idx}
              className="mm-search-hit"
              aria-selected={idx === selectedIdx}
              onMouseEnter={() => setSelectedIdx(idx)}
              onClick={() => handlePick(hit)}
              style={idx === selectedIdx ? { background: 'var(--mm-hover, rgba(127,127,127,0.12))' } : undefined}
            >
              <span className="mm-search-hit-channel">
                {hit.channel_type === 'D' ? <MessageCircle size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> : '#'} {hit.channel_display || hit.channel_name}
              </span>
              <span className="mm-search-hit-snippet">{renderHit(hit)}</span>
              <span className="mm-search-hit-time">
                {new Date(hit.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(panel, document.body) : null
}
