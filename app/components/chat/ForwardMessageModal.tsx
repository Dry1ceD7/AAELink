'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Hash, Lock, Search, Send, X } from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'

interface ForwardChannel {
  id: string
  name: string
  display_name: string
  type?: string
}

interface Props {
  open: boolean
  messageBody: string
  originalAuthor: string
  onClose: () => void
  currentWorkspaceId: string
}

export function ForwardMessageModal({ open, messageBody, originalAuthor, onClose, currentWorkspaceId }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [channels, setChannels] = useState<ForwardChannel[]>([])
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const loadChannels = useCallback(async () => {
    if (!currentWorkspaceId) return
    const res = await apiFetch(`/api/channels?team_id=${encodeURIComponent(currentWorkspaceId)}`)
    if (res.ok) {
      const data = await res.json()
      setChannels((data.channels || []) as ForwardChannel[])
    }
  }, [currentWorkspaceId])

  useEffect(() => {
    if (open) {
      void loadChannels()
      setQuery('')
      setSelectedId(null)
      setSent(false)
      window.setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open, loadChannels])

  const filtered = useMemo(() => {
    if (!query.trim()) return channels
    const q = query.toLowerCase()
    return channels.filter(c =>
      c.display_name.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
    )
  }, [channels, query])

  async function doForward() {
    if (!selectedId || sending) return
    setSending(true)
    const forwardedBody = `> _Forwarded from **${originalAuthor}**:_\n>\n> ${messageBody.split('\n').join('\n> ')}`
    await apiFetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_id: selectedId, body: forwardedBody })
    })
    setSending(false)
    setSent(true)
    window.setTimeout(() => onClose(), 1200)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      if (e.key === 'Enter' && selectedId) { e.preventDefault(); void doForward() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedId, sending])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="mm-modal-overlay" role="presentation" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mm-modal mm-forward-modal" role="dialog" aria-modal="true" aria-label="Forward message" onClick={e => e.stopPropagation()}>
        <div className="mm-forward-header">
          <h2>Forward message</h2>
          <button type="button" className="mm-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="mm-forward-preview">
          <span className="mm-forward-preview-author">{originalAuthor}</span>
          <p className="mm-forward-preview-body">{messageBody.length > 200 ? messageBody.slice(0, 200) + '…' : messageBody}</p>
        </div>

        <div className="mm-forward-search">
          <Search size={15} />
          <input ref={inputRef} type="search" placeholder="Search channels…" value={query} onChange={e => setQuery(e.target.value)} autoComplete="off" />
        </div>

        <ul className="mm-forward-list">
          {filtered.length === 0 ? (
            <li className="mm-forward-empty">No channels found</li>
          ) : (
            filtered.slice(0, 20).map(c => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`mm-forward-item${selectedId === c.id ? ' mm-forward-item--selected' : ''}`}
                  onClick={() => setSelectedId(c.id)}
                >
                  {c.type === 'P' ? <Lock size={14} /> : <Hash size={14} />}
                  <span>{c.display_name || c.name}</span>
                </button>
              </li>
            ))
          )}
        </ul>

        <div className="mm-modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>Cancel</button>
          <button type="button" className="slack-button" disabled={!selectedId || sending || sent} onClick={() => void doForward()}>
            {sent ? '✓ Sent!' : sending ? 'Sending…' : <><Send size={14} /> Forward</>}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
