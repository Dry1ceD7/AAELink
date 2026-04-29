'use client'

import { useCallback, useEffect, useRef } from 'react'
import { apiFetch } from '@/lib/apiClient'
import { touchRecentChannel } from '@/lib/recentChannels'

/**
 * Marks a channel as read on the server (advances read cursor).
 * Also touches the recent-channels LRU in local storage.
 */
export function useReadState(channelId: string | null, latestCreateAt: number) {
  const lastPostedRef = useRef(0)

  const markRead = useCallback(async () => {
    if (!channelId || latestCreateAt <= 0) return
    // Don't re-post the same watermark.
    if (latestCreateAt <= lastPostedRef.current) return
    lastPostedRef.current = latestCreateAt
    touchRecentChannel(channelId)
    try {
      await apiFetch('/api/collab/read-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_id: channelId,
          last_read_at: latestCreateAt
        })
      })
    } catch {
      /* ignore */
    }
  }, [channelId, latestCreateAt])

  // Mark read when the channel loads or new messages arrive while focused.
  useEffect(() => {
    if (typeof document === 'undefined') return
    if (document.visibilityState === 'visible') {
      void markRead()
    }
    const onVis = () => {
      if (document.visibilityState === 'visible') void markRead()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [markRead])

  // Reset watermark on channel switch.
  useEffect(() => {
    lastPostedRef.current = 0
  }, [channelId])
}
