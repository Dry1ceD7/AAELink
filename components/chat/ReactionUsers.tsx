'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api/apiClient'

interface ReactionUser {
  user_id: string
  username: string
  display_name: string
  avatar_url: string | null
  reacted_at: number
}

interface ReactionUsersResponse {
  message_id: string
  key: string
  users: ReactionUser[]
}

interface ReactionUsersProps {
  messageId: string
  emoji: string
  /** Human-readable label for the reaction (e.g. "thumbs up"). */
  label?: string
}

/**
 * Small popover listing the users who reacted to a message with a given
 * reaction key. Fetches lazily on mount and aborts the request on unmount.
 */
export function ReactionUsers({ messageId, emoji, label }: ReactionUsersProps) {
  const [users, setUsers] = useState<ReactionUser[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const ctrl = new AbortController()
    let active = true
    setUsers(null)
    setError(false)

    void (async () => {
      try {
        const res = await apiFetch(
          `/api/messages/reactions/users?message_id=${encodeURIComponent(messageId)}&key=${encodeURIComponent(emoji)}`,
          { signal: ctrl.signal }
        )
        if (!active) return
        if (!res.ok) {
          setError(true)
          return
        }
        const data = (await res.json()) as ReactionUsersResponse
        if (!active) return
        setUsers(Array.isArray(data.users) ? data.users : [])
      } catch (e) {
        if ((e as { name?: string }).name === 'AbortError') return
        if (active) setError(true)
      }
    })()

    return () => {
      active = false
      ctrl.abort()
    }
  }, [messageId, emoji])

  const popoverStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: 'calc(100% + 6px)',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 200,
    minWidth: 140,
    maxWidth: 240,
    padding: '6px 10px',
    borderRadius: 8,
    background: 'var(--mm-bg-elevated, #1f2024)',
    color: 'var(--mm-text-primary, #f5f5f5)',
    border: '1px solid var(--mm-border-subtle, rgba(255,255,255,0.12))',
    boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
    fontSize: 12,
    lineHeight: 1.4,
    pointerEvents: 'none',
    whiteSpace: 'normal'
  }

  let body: React.ReactNode
  if (error) {
    body = <span style={{ opacity: 0.7 }}>Could not load reactions</span>
  } else if (users === null) {
    body = <span style={{ opacity: 0.7 }}>Loading…</span>
  } else if (users.length === 0) {
    body = <span style={{ opacity: 0.7 }}>No one yet</span>
  } else {
    const names = users.map(u => u.display_name || u.username)
    body = (
      <>
        {label ? (
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{label}</div>
        ) : null}
        <div>{names.join(', ')}</div>
      </>
    )
  }

  return (
    <div role="tooltip" style={popoverStyle}>
      {body}
    </div>
  )
}
