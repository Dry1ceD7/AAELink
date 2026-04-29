'use client'

import type { ApiNotification } from '@/lib/notificationTypes'
import { apiFetch } from '@/lib/apiClient'
import { subscribeNetworkOrVisibilityResume } from '@/lib/sseResilience'

export type NotificationStreamPayload = {
  unread_count: number
  latest?: ApiNotification | null
}

const SSE_RETRY_MAX = 5
const SSE_RETRY_BASE_MS = 700
/** After burst failures, keep trying SSE on this interval (sleep / captive portal recovery). */
const SSE_FALLBACK_MS = 20_000
/** Coalesce `GET /api/notifications` on rapid online + visibility events before SSE reconnects. */
const PULL_DEBOUNCE_MS = 400

/**
 * Subscribes to server push for notification counter changes (SSE with DB poll, like collab).
 * Returns dispose. On each event, calls onEvent with parsed payload.
 */
export function connectNotificationStream(onEvent: (p: NotificationStreamPayload) => void): () => void {
  if (typeof window === 'undefined') return () => { }

  let disposed = false
  let es: EventSource | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let fallbackTimer: ReturnType<typeof setInterval> | null = null
  let failures = 0
  let removeResume: (() => void) | null = null
  let pullDebounceTimer: ReturnType<typeof setTimeout> | null = null

  const clearPullDebounce = () => {
    if (pullDebounceTimer) {
      clearTimeout(pullDebounceTimer)
      pullDebounceTimer = null
    }
  }

  const clearReconnect = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  const clearFallback = () => {
    if (fallbackTimer) {
      clearInterval(fallbackTimer)
      fallbackTimer = null
    }
  }

  const closeEs = () => {
    try {
      es?.close()
    } catch {
      /* ignore */
    }
    es = null
  }

  const pullUnreadFromApi = async () => {
    try {
      const res = await apiFetch('/api/notifications')
      if (!res.ok) return
      const data = (await res.json()) as { unread_count?: number }
      if (typeof data.unread_count === 'number') onEvent({ unread_count: data.unread_count })
    } catch {
      /* ignore */
    }
  }

  const attach = () => {
    if (disposed) return
    clearReconnect()
    clearFallback()
    closeEs()
    if (typeof EventSource === 'undefined') return
    try {
      const u = new URL('/api/notifications/stream', window.location.origin)
      const source = new EventSource(u.toString())
      es = source
      source.onopen = () => {
        failures = 0
      }
      source.onmessage = ev => {
        try {
          const data = JSON.parse(String(ev.data)) as NotificationStreamPayload
          if (typeof data.unread_count === 'number') failures = 0
          onEvent(data)
        } catch {
          /* ignore */
        }
      }
      source.onerror = () => {
        if (disposed) return
        closeEs()
        failures += 1
        if (failures <= SSE_RETRY_MAX) {
          reconnectTimer = setTimeout(() => attach(), SSE_RETRY_BASE_MS * failures)
        } else if (!fallbackTimer) {
          fallbackTimer = setInterval(() => {
            if (disposed) return
            failures = 0
            attach()
          }, SSE_FALLBACK_MS)
        }
      }
    } catch {
      /* no-op */
    }
  }

  const schedulePullUnreadDebounced = () => {
    clearPullDebounce()
    pullDebounceTimer = setTimeout(() => {
      pullDebounceTimer = null
      if (!disposed) void pullUnreadFromApi()
    }, PULL_DEBOUNCE_MS)
  }

  removeResume = subscribeNetworkOrVisibilityResume(() => {
    if (disposed) return
    schedulePullUnreadDebounced()
    failures = 0
    clearReconnect()
    clearFallback()
    closeEs()
    attach()
  })

  attach()

  return () => {
    disposed = true
    removeResume?.()
    removeResume = null
    clearPullDebounce()
    clearReconnect()
    clearFallback()
    closeEs()
  }
}
