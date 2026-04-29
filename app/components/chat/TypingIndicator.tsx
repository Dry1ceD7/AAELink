'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/apiClient'
import type { AppUser } from '@/app/components/chat/ChatMessage'
import { displayName } from '@/app/components/chat/ChatMessage'

// ── Constants ──────────────────────────────────────────────────────────────────

/** How often to POST the typing signal (server TTL is 8 s). */
const EMIT_INTERVAL_MS = 3_000
/** How often to poll for other users typing. */
const POLL_INTERVAL_MS = 2_500
/** After this many ms of silence from our side, stop typing. */
const IDLE_STOP_MS = 5_000

// ── Emitter hook: sends "I am typing" to the server ────────────────────────

export function useTypingEmitter(channelId: string, threadRootId?: string) {
  const lastEmitRef = useRef(0)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const channelRef = useRef(channelId)
  const threadRef = useRef(threadRootId)

  channelRef.current = channelId
  threadRef.current = threadRootId

  const sendStop = useCallback(() => {
    if (!channelRef.current) return
    void apiFetch('/api/collab/typing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel_id: channelRef.current,
        stop: true,
        ...(threadRef.current ? { thread_root_id: threadRef.current } : {})
      })
    }).catch(() => {})
  }, [])

  const emitTyping = useCallback(() => {
    if (!channelRef.current) return
    const now = Date.now()
    if (now - lastEmitRef.current < EMIT_INTERVAL_MS) return
    lastEmitRef.current = now

    void apiFetch('/api/collab/typing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel_id: channelRef.current,
        ...(threadRef.current ? { thread_root_id: threadRef.current } : {})
      })
    }).catch(() => {})

    // Reset idle timer
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => {
      sendStop()
      lastEmitRef.current = 0
    }, IDLE_STOP_MS)
  }, [sendStop])

  /** Call on every keystroke in the composer. */
  const onDraftChange = useCallback(
    (_text: string) => {
      emitTyping()
    },
    [emitTyping]
  )

  // Cleanup on unmount or channel switch: send stop signal.
  useEffect(() => {
    return () => {
      sendStop()
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    }
  }, [channelId, threadRootId, sendStop])

  return { onDraftChange }
}

// ── Display component: shows "X is typing…" ─────────────────────────────────

interface TypingIndicatorProps {
  channelId: string
  threadRootId?: string
  userMap: Record<string, AppUser>
  myId: string
}

export function TypingIndicator({ channelId, threadRootId, userMap, myId }: TypingIndicatorProps) {
  const [typingIds, setTypingIds] = useState<string[]>([])

  useEffect(() => {
    if (!channelId) return
    let cancelled = false

    const poll = async () => {
      try {
        const q = new URLSearchParams({ channel_id: channelId })
        if (threadRootId) q.set('root_id', threadRootId)
        const res = await apiFetch(`/api/collab/typing?${q}`, { method: 'GET' })
        if (res.ok && !cancelled) {
          const data = (await res.json()) as { user_ids?: string[] }
          setTypingIds((data.user_ids || []).filter(id => id !== myId))
        }
      } catch {
        /* ignore */
      }
    }

    void poll()
    const timer = setInterval(poll, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [channelId, threadRootId, myId])

  if (typingIds.length === 0) return null

  const names = typingIds.slice(0, 3).map(id => {
    const u = userMap[id]
    return u ? displayName(u) : id.slice(0, 8)
  })

  let label: string
  if (names.length === 1) {
    label = `${names[0]} is typing…`
  } else if (names.length === 2) {
    label = `${names[0]} and ${names[1]} are typing…`
  } else if (names.length === 3 && typingIds.length === 3) {
    label = `${names[0]}, ${names[1]}, and ${names[2]} are typing…`
  } else {
    label = `${names[0]}, ${names[1]}, and ${typingIds.length - 2} others are typing…`
  }

  return (
    <div className="typing-indicator" aria-live="polite" aria-atomic="true">
      <span className="typing-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="typing-label">{label}</span>
    </div>
  )
}
