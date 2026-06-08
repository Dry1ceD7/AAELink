'use client'

import { useMemo, useState } from 'react'
import { UserPlus, X, Check } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import { toast } from '@/lib/ui/toast'
import { PresenceDot } from '@/components/chat/PresenceDot'
import type { Presence } from '@/lib/types/presence'

type MemberUser = {
  id: string
  username?: string
  first_name?: string
  last_name?: string
  nickname?: string
  status_emoji?: string
  status_text?: string
}

/* Map the live presence-listener status ('online'|'away'|'dnd'|'offline') onto
   the shared Presence union ('active'|'away'|'dnd'|'offline') PresenceDot uses. */
function toPresence(status: string): Presence {
  switch (status) {
    case 'online':
    case 'active':
      return 'active'
    case 'away':
      return 'away'
    case 'dnd':
      return 'dnd'
    default:
      return 'offline'
  }
}

interface MemberListPanelProps {
  open: boolean
  members: MemberUser[]
  getStatus: (userId: string) => string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  displayName: (user: any) => string
  onOpenDm: (userId: string) => void
  onClose: () => void
  // Optional "Add people" wiring. When channelId + candidates are provided, the
  // panel renders an inline picker that adds members via /api/channel-members.
  channelId?: string
  candidates?: MemberUser[]
  onAdded?: () => void
}

export function MemberListPanel({
  open, members, getStatus, displayName, onOpenDm, onClose,
  channelId, candidates, onAdded,
}: MemberListPanelProps) {
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [pendingId, setPendingId] = useState<string | null>(null)

  const memberIds = useMemo(() => new Set(members.map(m => m.id)), [members])
  const canAddPeople = Boolean(channelId) && Array.isArray(candidates)

  const addable = useMemo(() => {
    const pool = (candidates ?? []).filter(u => !memberIds.has(u.id))
    const q = query.trim().toLowerCase()
    if (!q) return pool
    return pool.filter(u => {
      const name = displayName(u).toLowerCase()
      return name.includes(q) || (u.username || '').toLowerCase().includes(q)
    })
  }, [candidates, memberIds, query, displayName])

  if (!open) return null

  const handleAdd = async (userId: string) => {
    if (!channelId) return
    setPendingId(userId)
    const res = await apiFetch('/api/channel-members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_id: channelId, user_id: userId }),
    })
    setPendingId(null)
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string }
      toast.error(err.error === 'user_not_found' ? 'That user no longer exists.' : 'Could not add member.')
      return
    }
    toast.success('Member added.')
    onAdded?.()
  }

  return (
    <aside className="member-list-panel">
      <header className="member-list-header">
        <h2>Members</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {canAddPeople && (
            <button type="button" className="mm-icon-btn" onClick={() => { setAdding(a => !a); setQuery('') }}
              aria-label={adding ? 'Close add people' : 'Add people'} aria-pressed={adding}>
              {adding ? <X size={18} /> : <UserPlus size={18} />}
            </button>
          )}
          <button type="button" className="mm-icon-btn" onClick={onClose} aria-label="Close member list">
            <span aria-hidden>✕</span>
          </button>
        </div>
      </header>

      {canAddPeople && adding && (
        <div className="member-list-add" style={{ padding: '8px 12px', borderBottom: '1px solid var(--c-border)' }}>
          <input
            type="text"
            className="slack-input"
            placeholder="Add people to this channel…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />
          <div style={{ maxHeight: 200, overflowY: 'auto', marginTop: 8 }}>
            {addable.length === 0 ? (
              <p className="member-list-empty" style={{ padding: '8px 0' }}>No one left to add.</p>
            ) : (
              addable.map(u => (
                <button key={u.id} type="button" className="member-list-item"
                  disabled={pendingId === u.id}
                  onClick={() => void handleAdd(u.id)}>
                  <div className="member-list-info">
                    <strong>{displayName(u)}</strong>
                    <span>@{u.username}</span>
                  </div>
                  {pendingId === u.id ? <span className="module-loading" aria-hidden /> : <Check size={16} />}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <div className="member-list-body">
        {members.length === 0 ? (
          <p className="member-list-empty">No members to display.</p>
        ) : (
          members.map(u => {
            const status = toPresence(getStatus(u.id))
            const name = displayName(u)
            const hasCustom = Boolean(u.status_emoji || u.status_text)
            return (
              <button key={u.id} type="button" className="member-list-item" onClick={() => { onOpenDm(u.id); onClose() }}>
                <div className="member-list-avatar">
                  {(u.username || name).slice(0, 1).toUpperCase()}
                  {/* Server-derived presence dot, positioned over the avatar's
                      bottom-right corner. PresenceDot renders the CSS-colored dot;
                      custom status (if any) is shown inline beside the name below. */}
                  <span
                    className="member-list-presence"
                    style={{ background: 'transparent', border: 'none', display: 'inline-flex' }}
                  >
                    <PresenceDot status={status} size={10} />
                  </span>
                </div>
                <div className="member-list-info">
                  <strong>{name}</strong>
                  {hasCustom ? (
                    <span className="member-list-custom-status">
                      {u.status_emoji ? (
                        <span className="member-list-status-emoji" aria-hidden="true">{u.status_emoji}</span>
                      ) : null}
                      {u.status_text ? <span>{u.status_text}</span> : null}
                    </span>
                  ) : (
                    <span>@{u.username}</span>
                  )}
                </div>
              </button>
            )
          })
        )}
      </div>
    </aside>
  )
}
