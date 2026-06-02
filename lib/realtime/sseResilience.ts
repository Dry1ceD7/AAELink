'use client'

/**
 * Fires when the tab becomes visible again or the browser reports network online.
 * Use after sleep / Wi‑Fi drops to reopen SSE or trigger a sync (Slack-class resilience).
 */
export function subscribeNetworkOrVisibilityResume(onResume: () => void): () => void {
  if (typeof window === 'undefined') return () => {}

  const run = () => {
    try {
      onResume()
    } catch {
      /* ignore */
    }
  }

  const onOnline = () => run()

  const onVisibility = () => {
    if (document.visibilityState === 'visible') run()
  }

  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisibility)

  return () => {
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
