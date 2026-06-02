'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api/apiClient'
import { type AppUser, displayName } from './ChatMessage'
import type { RealtimeEventBus } from '@/lib/realtime/realtimeEventBus'

interface Props {
  channelId: string
  /** Map of userId → AppUser for labelling typing users. */
  userMap: Record<string, AppUser>
  /** Current user's ID — excluded from the typing display. */
  myId: string
  /** Optional thread root ID (for thread-scoped typing). */
  threadRootId?: string
  /**
   * Optional event bus from the home shell. When supplied, the indicator
   * subscribes to typing changes for this channel via the bus and skips the
   * GET poll entirely. When absent (e.g. legacy mounts, thread panels), the
   * indicator falls back to the v0.0.42 GET poll.
   */
  bus?: RealtimeEventBus
}

const POLL_INTERVAL = 2_000
const TYPING_TTL_MS = 8_000
const EMIT_THROTTLE = 3_000

/**
 * TypingIndicator — displays "X is typing…" or "X, Y are typing…" below the
 * message composer, just like Slack.
 *
 * Polls GET /api/typing every 2s to check who else is typing.
 */
export function TypingIndicator({ channelId, userMap, myId, bus }: Props) {
  const [typingNames, setTypingNames] = useState<string[]>([])
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const namesFromIds = useCallback((ids: readonly string[]): string[] => {
    return ids
      .filter(id => id !== myId)
      .map(id => {
        const user = userMap[id]
        return user ? displayName(user) : 'Someone'
      })
  }, [userMap, myId])

  const poll = useCallback(async () => {
    if (!channelId) return
    try {
      const res = await apiFetch(`/api/typing?channel_id=${encodeURIComponent(channelId)}`)
      if (res.ok) {
        const data = (await res.json()) as { typing: string[] }
        setTypingNames(namesFromIds(data.typing || []))
      }
    } catch {
      // Silently ignore — typing indicators are non-critical
    }
  }, [channelId, namesFromIds])

  useEffect(() => {
    setTypingNames([])
    if (!channelId) return

    // ── WS-bus path ─────────────────────────────────────────────────
    // When the home shell supplies a `bus`, the indicator forwards live
    // events directly; the GET poll is skipped entirely.
    if (bus) {
      const lastSeen = new Map<string, number>()
      const refreshNames = () => {
        const now = Date.now()
        const live: string[] = []
        for (const [uid, ts] of lastSeen) {
          if (now - ts <= TYPING_TTL_MS) live.push(uid)
          else lastSeen.delete(uid)
        }
        setTypingNames(namesFromIds(live))
      }
      const off = bus.subscribeTyping(channelId, change => {
        if (change.active) {
          lastSeen.set(change.userId, Date.now())
        } else {
          lastSeen.delete(change.userId)
        }
        refreshNames()
      })
      // Re-run TTL sweep every second so stale typers fade out without a
      // fresh `active: false` (matches the legacy poll semantics).
      const sweep = setInterval(refreshNames, 1_000)
      return () => {
        off()
        clearInterval(sweep)
      }
    }

    // ── Legacy poll fallback ────────────────────────────────────────
    void poll()
    pollTimer.current = setInterval(() => void poll(), POLL_INTERVAL)
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current)
    }
  }, [channelId, poll, bus, namesFromIds])

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
