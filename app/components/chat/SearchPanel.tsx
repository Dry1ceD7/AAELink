'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, X, MessageCircle } from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'

interface SearchHit {
  id: string
  channel_id: string
  channel_name: string
  channel_display: string
  channel_type: string
  snippet: string
  created_at: number
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
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Focus input when opened
  useEffect(() => {
    if (!open) { setQuery(''); setHits([]); setSearched(false); return }
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open])

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
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="mm-search-close" onClick={onClose} aria-label="Close search">
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="mm-search-results">
          {loading && <p className="mm-search-status">Searching…</p>}
          {!loading && searched && hits.length === 0 && (
            <p className="mm-search-status">No messages found for &ldquo;{query.trim()}&rdquo;</p>
          )}
          {hits.map(hit => (
            <button key={hit.id} type="button" className="mm-search-hit" onClick={() => handlePick(hit)}>
              <span className="mm-search-hit-channel">
                {hit.channel_type === 'D' ? <MessageCircle size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> : '#'} {hit.channel_display || hit.channel_name}
              </span>
              <span className="mm-search-hit-snippet">{hit.snippet}</span>
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
