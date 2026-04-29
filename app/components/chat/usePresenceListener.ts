'use client'

import { useEffect, useState } from 'react'

export type PresenceStatus = 'online' | 'away' | 'offline'

/**
 * Connects to the SSE presence stream to receive real-time updates of users' last_seen_at.
 * Computes online/away/offline status based on recency.
 */
export function usePresenceListener(workspaceId: string) {
  const [presenceMap, setPresenceMap] = useState<Record<string, number>>({})

  useEffect(() => {
    if (!workspaceId) return
    let es: EventSource | null = null

    const connect = () => {
      const u = new URL('/api/collab/presence/stream', window.location.origin)
      u.searchParams.set('workspace_id', workspaceId)
      es = new EventSource(u.toString())

      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as { presence?: Record<string, number> }
          if (data.presence) {
            setPresenceMap(data.presence)
          }
        } catch {
          // ignore
        }
      }
      
      es.onerror = () => {
        es?.close()
        setTimeout(connect, 5000)
      }
    }

    connect()

    return () => {
      es?.close()
    }
  }, [workspaceId])

  const getStatus = (userId: string): PresenceStatus => {
    const lastSeen = presenceMap[userId] || 0
    const diff = Date.now() - lastSeen
    
    // Online within 2 minutes
    if (diff < 2 * 60 * 1000) return 'online'
    // Away within 10 minutes
    if (diff < 10 * 60 * 1000) return 'away'
    return 'offline'
  }

  return { getStatus }
}
