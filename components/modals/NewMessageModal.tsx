'use client'

import React, { useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { X, Search, Check } from 'lucide-react'

type AppUser = {
  id: string
  username: string
  first_name?: string | null
  last_name?: string | null
  nickname?: string | null
  avatar_url?: string | null
}

export type NewMessageModalProps = {
  open: boolean
  onClose: () => void
  users: AppUser[]
  meId: string
  onStartChat: (peerIds: string[]) => void
}

function getDisplayName(u: AppUser) {
  const full = `${u.first_name || ''} ${u.last_name || ''}`.trim()
  if (full) return full
  if (u.nickname) return u.nickname
  return u.username
}

export function NewMessageModal({ open, onClose, users, meId, onStartChat }: NewMessageModalProps) {
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const peers = useMemo(() => users.filter(u => u.id !== meId), [users, meId])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return peers
    return peers.filter(u => {
      const display = getDisplayName(u).toLowerCase()
      const username = u.username.toLowerCase()
      return display.includes(q) || username.includes(q)
    })
  }, [peers, query])

  if (!open) return null

  const handleToggle = (id: string) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  const handleStart = () => {
    if (selectedIds.size === 0) return
    onStartChat(Array.from(selectedIds))
    onClose()
  }

  const selectedUsers = peers.filter(u => selectedIds.has(u.id))

  const node = (
    <div className="mm-modal-overlay" role="presentation" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mm-modal" role="dialog" aria-modal="true" aria-labelledby="new-message-title">
        <div className="mm-modal-header">
          <h2 id="new-message-title" className="mm-modal-title">New message</h2>
          <button type="button" className="mm-modal-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="mm-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: '300px' }}>
          {selectedUsers.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', padding: '0.5rem', background: 'var(--c-bg-tertiary)', borderRadius: '8px' }}>
              {selectedUsers.map(u => (
                <span key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', background: 'var(--c-bg-secondary)', padding: '2px 8px', borderRadius: '8px', fontSize: '13px' }}>
                  {getDisplayName(u)}
                  <button type="button" onClick={() => handleToggle(u.id)} style={{ background: 'none', border: 'none', color: 'var(--c-text-secondary)', cursor: 'pointer', padding: 0, display: 'flex' }}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          
          <div className="mm-input-wrap">
            <Search size={16} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--c-text-tertiary)' }} />
            <input
              type="text"
              className="mm-input"
              style={{ paddingLeft: '34px' }}
              placeholder="Search people..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoFocus
            />
          </div>

          <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--c-border)', borderRadius: '8px' }}>
            {filtered.length === 0 ? (
              <p style={{ padding: '1rem', textAlign: 'center', color: 'var(--c-text-secondary)' }}>No matches found.</p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {filtered.map(u => {
                  const isSelected = selectedIds.has(u.id)
                  return (
                    <li key={u.id}>
                      <button
                        type="button"
                        onClick={() => handleToggle(u.id)}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '0.75rem 1rem', background: 'none', border: 'none', borderBottom: '1px solid var(--c-border)',
                          cursor: 'pointer', textAlign: 'left', color: 'var(--c-text)'
                        }}
                      >
                        <span style={{ fontWeight: 500 }}>{getDisplayName(u)}</span>
                        {isSelected && <Check size={16} color="var(--c-primary)" />}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
        <div className="mm-modal-footer">
          <button type="button" className="mm-btn mm-btn--secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="mm-btn mm-btn--primary" onClick={handleStart} disabled={selectedIds.size === 0}>
            Start Chat
          </button>
        </div>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(node, document.body) : null
}
