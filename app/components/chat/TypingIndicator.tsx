'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/apiClient'
import { type AppUser, displayName } from './ChatMessage'

interface Props {
  channelId: string
  /** Map of userId → AppUser for labelling typing users. */
  userMap: Record<string, AppUser>
  /** Current user's ID — excluded from the typing display. */
  myId: string
  /** Optional thread root ID (for thread-scoped typing). */
  threadRootId?: string
}

const POLL_INTERVAL = 2_000
const EMIT_THROTTLE = 3_000

/**
 * TypingIndicator — displays "X is typing…" or "X, Y are typing…" below the
 * message composer, just like Slack.
 *
 * Polls GET /api/typing every 2s to check who else is typing.
 */
export function TypingIndicator({ channelId, userMap, myId }: Props) {
  const [typingNames, setTypingNames] = useState<string[]>([])
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const poll = useCallback(async () => {
    if (!channelId) return
    try {
      const res = await apiFetch(`/api/typing?channel_id=${encodeURIComponent(channelId)}`)
      if (res.ok) {
        const data = (await res.json()) as { typing: string[] }
        const names = (data.typing || [])
          .filter(id => id !== myId)
          .map(id => {
            const user = userMap[id]
            return user ? displayName(user) : 'Someone'
          })
        setTypingNames(names)
      }
    } catch {
      // Silently ignore — typing indicators are non-critical
    }
  }, [channelId, userMap, myId])

  useEffect(() => {
    setTypingNames([])
    if (!channelId) return
    void poll()
    pollTimer.current = setInterval(() => void poll(), POLL_INTERVAL)
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current)
    }
  }, [channelId, poll])

  if (typingNames.length === 0) return null

  let label: string
  if (typingNames.length === 1) {
    label = `${typingNames[0]} is typing`
  } else if (typingNames.length === 2) {
    label = `${typingNames[0]} and ${typingNames[1]} are typing`
  } else {
    label = `${typingNames[0]} and ${typingNames.length - 1} others are typing`
  }

  return (
    <div className="typing-indicator" aria-live="polite" aria-atomic="true">
      <span className="typing-dots">
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-dot" />
      </span>
      <span className="typing-label">{label}</span>
    </div>
  )
}

/**
 * Hook used by the main page to create a `onDraftChange` callback that
 * emits typing events (POST /api/typing) throttled to once every 3s.
 *
 * @param channelId  The channel to emit typing for
 * @param threadRootId  Optional thread root (for thread-level typing — currently uses same channel endpoint)
 */
export function useTypingEmitter(channelId: string, _threadRootId?: string) {
  const lastEmit = useRef(0)

  const onDraftChange = useCallback((_text: string) => {
    if (!channelId) return
    const now = Date.now()
    if (now - lastEmit.current < EMIT_THROTTLE) return
    lastEmit.current = now
    void apiFetch('/api/typing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_id: channelId })
    })
  }, [channelId])

  return { onDraftChange }
}
