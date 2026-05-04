'use client'

import { useCallback, useEffect, useRef } from 'react'
import { apiFetch } from '@/lib/apiClient'

/** How often to send a heartbeat to the presence endpoint (Slack: ~60 s). */
const HEARTBEAT_INTERVAL_MS = 45_000

/**
 * Sends periodic presence heartbeats to `/api/collab/presence`.
 * The server updates `users.last_seen_at` which downstream collab consumers
 * use to compute online/offline/away status.
 *
 * Call once at the top-level authenticated layout. Automatically pauses
 * when the tab is hidden and resumes on visibility change.
 */
export function usePresenceHeartbeat() {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const beat = useCallback(async () => {
    try {
      await apiFetch('/api/collab/presence', { method: 'POST' })
    } catch {
      /* ignore */
    }
    // Piggyback: dispatch any due scheduled messages (fire-and-forget)
    apiFetch('/api/scheduled-messages/dispatch', { method: 'POST' }).catch(() => {})
    // Piggyback: fire due reminders as notifications
    apiFetch('/api/reminders/dispatch', { method: 'POST' }).catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false

    const start = () => {
      if (cancelled) return
      void beat()
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = setInterval(() => {
        if (!cancelled) void beat()
      }, HEARTBEAT_INTERVAL_MS)
    }

    const stop = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        start()
      } else {
        stop()
      }
    }

    start()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [beat])
}
