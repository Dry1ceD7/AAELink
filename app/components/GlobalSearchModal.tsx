'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, X, Hash, MessageSquare, Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'
import { MessageRichText } from '@/lib/messageRich'

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
    if (q.length < 2) { setResults([]); setTotal(0); setSearched(false); return }
    setLoading(true)
    setSearched(true)
    const params = new URLSearchParams({ q, limit: '25' })
    if (workspaceId) params.set('workspace_id', workspaceId)
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
    if (!query || query.length < 2) return <MessageRichText text={body} />
    // Truncate long bodies around the match
    const lower = body.toLowerCase()
    const qLower = query.toLowerCase()
    const idx = lower.indexOf(qLower)
    if (idx === -1) return <MessageRichText text={body.slice(0, 200)} />
    const start = Math.max(0, idx - 60)
    const end = Math.min(body.length, idx + query.length + 100)
    const snippet = (start > 0 ? '…' : '') + body.slice(start, end) + (end < body.length ? '…' : '')
    return <MessageRichText text={snippet} />
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
            placeholder="Search messages…"
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
              <p>No messages found matching &quot;{query}&quot;</p>
            </div>
          )}

          {!loading && results.length > 0 && (
            <>
              <div className="global-search-count">
                {total} result{total !== 1 ? 's' : ''} found
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

          {!loading && !searched && (
            <div className="global-search-status">
              <Search size={28} strokeWidth={1.5} />
              <p>Search across all your messages and channels</p>
              <span style={{ fontSize: 12, color: 'var(--mm-muted)' }}>Type at least 2 characters to start</span>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
