'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Hash, Lock, MessageSquare, Search, Send, X } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import { toast } from '@/lib/ui/toast'

interface ForwardChannel {
  id: string
  name: string
  display_name: string
  type?: string
}

interface ForwardUser {
  id: string
  username: string
  first_name?: string
  last_name?: string
  avatar_url?: string
}

interface Props {
  open: boolean
  messageBody: string
  originalAuthor: string
  onClose: () => void
  currentWorkspaceId: string
}

type ForwardTarget = { kind: 'channel'; channel: ForwardChannel } | { kind: 'dm'; user: ForwardUser }

export function ForwardMessageModal({ open, messageBody, originalAuthor, onClose, currentWorkspaceId }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [channels, setChannels] = useState<ForwardChannel[]>([])
  const [users, setUsers] = useState<ForwardUser[]>([])
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [selected, setSelected] = useState<ForwardTarget | null>(null)
  const [comment, setComment] = useState('')
  const [tab, setTab] = useState<'channels' | 'people'>('channels')

  const loadChannels = useCallback(async () => {
    if (!currentWorkspaceId) return
    const res = await apiFetch(`/api/channels?team_id=${encodeURIComponent(currentWorkspaceId)}`)
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { channels?: ForwardChannel[] }
      setChannels(data.channels || [])
    }
  }, [currentWorkspaceId])

  const loadUsers = useCallback(async () => {
    if (!currentWorkspaceId) return
    const res = await apiFetch(`/api/users?workspace_id=${encodeURIComponent(currentWorkspaceId)}`)
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { members?: ForwardUser[]; users?: ForwardUser[] }
      setUsers(data.members || data.users || [])
    }
  }, [currentWorkspaceId])

  useEffect(() => {
    if (open) {
      void loadChannels()
      void loadUsers()
      setQuery('')
      setSelected(null)
      setSent(false)
      setComment('')
      setTab('channels')
      window.setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open, loadChannels, loadUsers])

  const filteredChannels = useMemo(() => {
    if (!query.trim()) return channels
    const q = query.toLowerCase()
    return channels.filter(c =>
      c.display_name.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
    )
  }, [channels, query])

  const filteredUsers = useMemo(() => {
    if (!query.trim()) return users
    const q = query.toLowerCase()
    return users.filter(u => {
      const full = `${u.first_name || ''} ${u.last_name || ''}`.trim().toLowerCase()
      return u.username.toLowerCase().includes(q) || full.includes(q)
    })
  }, [users, query])

  async function doForward() {
    if (!selected || sending) return
    setSending(true)

    const forwardedBody = `> _Forwarded from **${originalAuthor}**:_\n>\n> ${messageBody.split('\n').join('\n> ')}`
    const fullBody = comment.trim()
      ? `${comment.trim()}\n\n${forwardedBody}`
      : forwardedBody

    let ok = false

    if (selected.kind === 'channel') {
      const res = await apiFetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: selected.channel.id, body: fullBody })
      })
      ok = res.ok
    } else {
      // Create or get DM channel, then send
      const dmRes = await apiFetch('/api/channels/dm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: currentWorkspaceId, user_id: selected.user.id })
      })
      if (dmRes.ok) {
        const dmData = (await dmRes.json().catch(() => ({}))) as { channel_id?: string }
        if (dmData.channel_id) {
          const res = await apiFetch('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel_id: dmData.channel_id, body: fullBody })
          })
          ok = res.ok
        }
      }
    }

    if (!ok) {
      setSending(false)
      toast.error('Failed to forward message')
      return
    }

    setSending(false)
    setSent(true)
    window.setTimeout(() => onClose(), 1200)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      if (e.key === 'Enter' && e.metaKey && selected) { e.preventDefault(); void doForward() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selected, sending])

  if (!open || typeof document === 'undefined') return null

  function userDisplayName(u: ForwardUser): string {
    const full = `${u.first_name || ''} ${u.last_name || ''}`.trim()
    return full || u.username
  }

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

        {/* Optional comment */}
        <div className="mm-forward-comment">
          <input
            type="text"
            placeholder="Add a comment (optional)…"
            value={comment}
            onChange={e => setComment(e.target.value)}
            className="slack-input"
            style={{ fontSize: 13, padding: '6px 10px' }}
          />
        </div>

        {/* Tab toggle */}
        <div className="mm-forward-tabs">
          <button type="button"
            className={`mm-forward-tab${tab === 'channels' ? ' mm-forward-tab--active' : ''}`}
            onClick={() => setTab('channels')}>
            <Hash size={13} /> Channels
          </button>
          <button type="button"
            className={`mm-forward-tab${tab === 'people' ? ' mm-forward-tab--active' : ''}`}
            onClick={() => setTab('people')}>
            <MessageSquare size={13} /> People
          </button>
        </div>

        <div className="mm-forward-search">
          <Search size={15} />
          <input ref={inputRef} type="search"
            placeholder={tab === 'channels' ? 'Search channels…' : 'Search people…'}
            value={query} onChange={e => setQuery(e.target.value)} autoComplete="off" />
        </div>

        <ul className="mm-forward-list">
          {tab === 'channels' ? (
            filteredChannels.length === 0 ? (
              <li className="mm-forward-empty">No channels found</li>
            ) : (
              filteredChannels.slice(0, 20).map(c => (
                <li key={c.id}>
                  <button
                    type="button"
                    className={`mm-forward-item${selected?.kind === 'channel' && selected.channel.id === c.id ? ' mm-forward-item--selected' : ''}`}
                    onClick={() => setSelected({ kind: 'channel', channel: c })}
                  >
                    {c.type === 'P' ? <Lock size={14} /> : <Hash size={14} />}
                    <span>{c.display_name || c.name}</span>
                  </button>
                </li>
              ))
            )
          ) : (
            filteredUsers.length === 0 ? (
              <li className="mm-forward-empty">No people found</li>
            ) : (
              filteredUsers.slice(0, 20).map(u => (
                <li key={u.id}>
                  <button
                    type="button"
                    className={`mm-forward-item${selected?.kind === 'dm' && selected.user.id === u.id ? ' mm-forward-item--selected' : ''}`}
                    onClick={() => setSelected({ kind: 'dm', user: u })}
                  >
                    {u.avatar_url ? (
                      <img src={u.avatar_url} alt="" style={{ width: 20, height: 20, borderRadius: '50%' }} />
                    ) : (
                      <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--mm-bg-hover)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>
                        {u.username.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <span>{userDisplayName(u)}</span>
                    <span style={{ color: 'var(--mm-muted)', fontSize: 12, marginLeft: 'auto' }}>@{u.username}</span>
                  </button>
                </li>
              ))
            )
          )}
        </ul>

        <div className="mm-modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>Cancel</button>
          <button type="button" className="slack-button" disabled={!selected || sending || sent} onClick={() => void doForward()}>
            {sent ? '✓ Sent!' : sending ? 'Sending…' : <><Send size={14} /> Forward</>}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
