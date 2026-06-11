/**
 * Client-side hook that periodically calls the status-expire endpoint
 * to clear expired custom statuses. Runs every 60s.
 */

import { useEffect } from 'react'
import { apiFetch } from '@/lib/api/apiClient'

/**
 * Periodically calls /api/user-status/expire to auto-clear
 * expired custom statuses (Slack "Clear after…" feature).
 */
export function useStatusExpiry(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return

    const tick = () => {
      apiFetch('/api/user-status/expire', { method: 'POST' }).catch(() => {})
    }

    // Run immediately on mount, then every 60s
    tick()
    const id = window.setInterval(tick, 60_000)
    return () => window.clearInterval(id)
  }, [enabled])
}
