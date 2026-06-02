'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MessageSquare, Shield, Phone, Building2, BellOff, Clock } from 'lucide-react'
import type { AppUser } from '@/components/chat/ChatMessage'

/**
 * Per-mention hovercard. Mounts once at the page root and listens for
 * `mouseenter`/`mouseleave` on any `[data-mention-username]` element under
 * `targetRef`. After a 300ms hover delay it shows a mini profile card
 * positioned next to the mention. Closes on mouse leave (with a 150ms
 * grace period so the card itself can be hovered).
 *
 * Closes immediately on Escape and on any click outside the card.
 *
 * `userMap` is the page-level username/id map. `getStatus(userId)` returns
 * the live presence string (`online` | `away` | `dnd` | `offline`).
 */

interface Props {
  userMap: Record<string, AppUser>
  /** Get presence by userId (page-level). */
  getStatus: (userId: string) => string
  /** When the user clicks "Message" in the card. */
  onStartDm?: (userId: string) => void
  /** When the user clicks the card name → open full profile drawer. */
  onOpenFullProfile?: (userId: string) => void
}

const STATUS_COLOR: Record<string, string> = {
  online: 'var(--mm-online)',
  away: 'var(--mm-away)',
  dnd: '#d24b4e',
  offline: 'var(--mm-offline)',
}

const STATUS_LABEL: Record<string, string> = {
  online: 'Online',
  away: 'Away',
  dnd: 'Do Not Disturb',
  offline: 'Offline',
}

function displayName(u: AppUser): string {
  const full = `${u.first_name || ''} ${u.last_name || ''}`.trim()
  if (full) return full
  return u.username
}

interface OpenState {
  user: AppUser
  anchor: DOMRect
}

export function UserHovercard({ userMap, getStatus, onStartDm, onOpenFullProfile }: Props) {
  const [state, setState] = useState<OpenState | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)

  // Map username → user (rebuilt only when userMap changes).
  const usernameIndex = useRef<Map<string, AppUser>>(new Map())
  useEffect(() => {
    const idx = new Map<string, AppUser>()
    for (const u of Object.values(userMap)) {
      if (u && u.username) idx.set(u.username, u)
    }
    usernameIndex.current = idx
  }, [userMap])

  const cancelHoverTimer = useCallback(() => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
  }, [])
  const cancelCloseTimer = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const onEnter = (ev: Event) => {
      const target = (ev.target as HTMLElement | null)?.closest('[data-mention-username]') as HTMLElement | null
      if (!target) return
      const uname = target.dataset.mentionUsername
      if (!uname) return
      const user = usernameIndex.current.get(uname)
      if (!user) return
      cancelHoverTimer()
      cancelCloseTimer()
      hoverTimer.current = setTimeout(() => {
        const rect = target.getBoundingClientRect()
        setState({ user, anchor: rect })
      }, 300)
    }
    const onLeave = (ev: Event) => {
      const t = ev.target as HTMLElement | null
      if (!t || !t.closest?.('[data-mention-username]')) return
      cancelHoverTimer()
      // Grace period — let the user move into the card itself.
      cancelCloseTimer()
      closeTimer.current = setTimeout(() => setState(null), 150)
    }
    document.addEventListener('mouseenter', onEnter, true)
    document.addEventListener('mouseleave', onLeave, true)
    return () => {
      document.removeEventListener('mouseenter', onEnter, true)
      document.removeEventListener('mouseleave', onLeave, true)
      cancelHoverTimer()
      cancelCloseTimer()
    }
  }, [cancelHoverTimer, cancelCloseTimer])

  // Esc + click-outside dismiss.
  useEffect(() => {
    if (!state) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setState(null)
    }
    const onDocClick = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setState(null)
      }
    }
    document.addEventListener('keydown', onKey)
    // Defer so the click that opened it doesn't also close it.
    const t = setTimeout(() => document.addEventListener('mousedown', onDocClick), 50)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDocClick)
      clearTimeout(t)
    }
  }, [state])

  if (!state || typeof document === 'undefined') return null

  const { user, anchor } = state
  const status = getStatus(user.id)
  const name = displayName(user)
  const initial = (name.slice(0, 1) || '?').toUpperCase()
  const roleLabel = user.platform_role === 'superadmin' ? 'Super Admin'
    : user.platform_role === 'it_admin' ? 'IT Admin'
    : user.platform_role === 'it_support' ? 'IT Support'
    : 'Member'

  // Position: prefer below the mention, but flip above if it would overflow.
  const cardW = 280
  const cardH = 220
  const margin = 8
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1200
  const wantTop = anchor.bottom + margin
  const flipsAbove = wantTop + cardH > viewportH
  const top = flipsAbove ? Math.max(margin, anchor.top - cardH - margin) : wantTop
  const left = Math.max(margin, Math.min(viewportW - cardW - margin, anchor.left))

  const card = (
    <div
      ref={cardRef}
      className="user-hovercard aae-pop-in"
      role="dialog"
      aria-label={`Profile preview for ${name}`}
      style={{ position: 'fixed', top, left, width: cardW, zIndex: 9000 }}
      onMouseEnter={cancelCloseTimer}
      onMouseLeave={() => {
        cancelCloseTimer()
        closeTimer.current = setTimeout(() => setState(null), 150)
      }}
    >
      <div className="user-hovercard-row" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="user-hovercard-avatar" style={{
          width: 40, height: 40, borderRadius: 8,
          background: user.avatar_url ? `url(${user.avatar_url}) center/cover no-repeat` : 'var(--aae-cyan, #00c2e8)',
          color: '#fff', display: 'grid', placeItems: 'center',
          fontWeight: 800, fontSize: 16,
          position: 'relative', flexShrink: 0,
        }}>
          {!user.avatar_url ? initial : null}
          <span style={{
            position: 'absolute', right: -2, bottom: -2,
            width: 12, height: 12, borderRadius: '50%',
            border: '2px solid var(--mm-bg, #fff)',
            background: STATUS_COLOR[status] || STATUS_COLOR.offline,
          }} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <button
            type="button"
            className="user-hovercard-name"
            onClick={() => onOpenFullProfile?.(user.id)}
            style={{
              background: 'none', border: 'none', padding: 0,
              fontWeight: 700, fontSize: 14, color: 'var(--mm-text)',
              cursor: 'pointer', textAlign: 'left',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              maxWidth: '100%',
            }}
          >
            {name}
          </button>
          <div style={{ fontSize: 12, opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            @{user.username}
          </div>
        </div>
      </div>

      {(user.job_title) && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--mm-muted)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Building2 size={11} /> {user.job_title}
          </div>
        </div>
      )}

      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[status] || STATUS_COLOR.offline }} />
        <span>{STATUS_LABEL[status] || 'Offline'}</span>
        {status === 'dnd' && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#d24b4e', marginLeft: 4 }}>
            <BellOff size={11} /> DND
          </span>
        )}
      </div>

      {user.timezone && (
        <div style={{ marginTop: 4, fontSize: 12, color: 'var(--mm-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Clock size={11} />
          {(() => {
            try {
              return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: user.timezone }) + ' local'
            } catch { return user.timezone }
          })()}
        </div>
      )}

      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--mm-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
        <Shield size={11} /> {roleLabel}
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
        {onStartDm && (
          <button type="button" className="slack-button" onClick={() => { onStartDm(user.id); setState(null) }}>
            <MessageSquare size={12} /> Message
          </button>
        )}
        {user.phone && (
          <a className="ghost-button" href={`tel:${user.phone}`}>
            <Phone size={12} /> Call
          </a>
        )}
      </div>
    </div>
  )
  return createPortal(card, document.body)
}
