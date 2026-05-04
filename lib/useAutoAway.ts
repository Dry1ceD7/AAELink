/**
 * useAutoAway — Automatically sets user presence to "away" after a
 * period of inactivity (default: 5 minutes). Restores to "online"
 * when the user becomes active again.
 *
 * Tracks mousemove, keydown, mousedown, touchstart, scroll, and
 * the Page Visibility API (visibilitychange).
 *
 * Inspired by Slack's auto-away behavior.
 */
'use client'

import { useEffect, useRef, useCallback } from 'react'
import { apiFetch } from '@/lib/apiClient'

const IDLE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

function setPresence(status: 'online' | 'away') {
  void apiFetch('/api/collab/presence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  }).catch(() => { /* ignore */ })
}

export function useAutoAway() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isAwayRef = useRef(false)

  const goAway = useCallback(() => {
    if (!isAwayRef.current) {
      isAwayRef.current = true
      setPresence('away')
    }
  }, [])

  const comeBack = useCallback(() => {
    if (isAwayRef.current) {
      isAwayRef.current = false
      setPresence('online')
    }
    // Reset timer
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(goAway, IDLE_TIMEOUT_MS)
  }, [goAway])

  useEffect(() => {
    // Start idle timer
    timerRef.current = setTimeout(goAway, IDLE_TIMEOUT_MS)

    const onActivity = () => comeBack()

    // Listen for user activity
    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'] as const
    for (const ev of events) {
      window.addEventListener(ev, onActivity, { passive: true })
    }

    // Page visibility change (switching tabs)
    const onVisChange = () => {
      if (document.hidden) {
        // Start shorter timer when tab hidden
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(goAway, 60_000) // 1 min when tab hidden
      } else {
        comeBack()
      }
    }
    document.addEventListener('visibilitychange', onVisChange)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      for (const ev of events) {
        window.removeEventListener(ev, onActivity)
      }
      document.removeEventListener('visibilitychange', onVisChange)
    }
  }, [goAway, comeBack])
}
