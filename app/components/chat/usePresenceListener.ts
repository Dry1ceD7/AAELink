'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/apiClient'

export type PresenceStatus = 'online' | 'away' | 'dnd' | 'offline'

/**
 * Connects to the SSE presence stream to receive real-time updates of users' last_seen_at.
 * Also periodically fetches explicit user statuses (DND) from the user-status API.
 * Computes online/away/dnd/offline status based on recency and manual overrides.
 */
export function usePresenceListener(workspaceId: string) {
  const [presenceMap, setPresenceMap] = useState<Record<string, number>>({})
  const [statusOverrides, setStatusOverrides] = useState<Record<string, PresenceStatus>>({})

  // SSE connection for real-time last_seen_at timestamps
  useEffect(() => {
    if (!workspaceId) return
    let es: EventSource | null = null
    let reconnectDelay = 2000

    const connect = () => {
      const u = new URL('/api/collab/presence/stream', window.location.origin)
      u.searchParams.set('workspace_id', workspaceId)
      es = new EventSource(u.toString())

      es.onmessage = (ev) => {
        // Reset backoff on successful message
        reconnectDelay = 2000
        try {
          const data = JSON.parse(ev.data) as {
            presence?: Record<string, number>
            statuses?: Record<string, PresenceStatus>
          }
          if (data.presence) {
            setPresenceMap(data.presence)
          }
          // If the SSE stream also emits explicit statuses (DND, etc.)
          if (data.statuses) {
            setStatusOverrides(prev => ({ ...prev, ...data.statuses }))
          }
        } catch {
          // ignore
        }
      }
      
      es.onerror = () => {
        es?.close()
        setTimeout(connect, reconnectDelay)
        reconnectDelay = Math.min(reconnectDelay * 2, 30000)
      }
    }

    connect()

    return () => {
      es?.close()
    }
  }, [workspaceId])

  // Periodic fetch of explicit user-set statuses (DND overrides)
  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false

    const fetchStatuses = async () => {
      try {
        const res = await apiFetch(`/api/user-status/bulk?workspace_id=${encodeURIComponent(workspaceId)}`)
        if (res.ok && !cancelled) {
          const data = (await res.json()) as { statuses?: Record<string, string> }
          if (data.statuses) {
            const overrides: Record<string, PresenceStatus> = {}
            for (const [uid, s] of Object.entries(data.statuses)) {
              if (s === 'dnd') overrides[uid] = 'dnd'
            }
            setStatusOverrides(prev => ({ ...prev, ...overrides }))
          }
        }
      } catch {
        // ignore — DND fetch is non-critical
      }
    }

    void fetchStatuses()
    const interval = setInterval(fetchStatuses, 60_000) // Every 60s

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [workspaceId])

  const getStatus = useCallback((userId: string): PresenceStatus => {
    // DND override takes priority
    if (statusOverrides[userId] === 'dnd') return 'dnd'

    const lastSeen = presenceMap[userId] || 0
    const diff = Date.now() - lastSeen
    
    // Online within 2 minutes
    if (diff < 2 * 60 * 1000) return 'online'
    // Away within 10 minutes
    if (diff < 10 * 60 * 1000) return 'away'
    return 'offline'
  }, [presenceMap, statusOverrides])

  return { getStatus }
}
