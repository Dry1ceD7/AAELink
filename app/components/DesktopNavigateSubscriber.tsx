'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Electron: when the user clicks a chat notification, the main process sends
 * `aaelink-navigate-home`. Subscribe from the root layout so navigation works
 * even when `/home` is not mounted (login, settings, etc.).
 */
export function DesktopNavigateSubscriber() {
  const router = useRouter()

  useEffect(() => {
    const unsub = window.aaelinkDesktop?.subscribeNavigateHome?.(payload => {
      const team = String(payload?.workspace_id ?? '').trim()
      const focus = String(payload?.focus_message_id ?? '').trim()
      if (!team || !focus) return
      const p = new URLSearchParams()
      p.set('team', team)
      p.set('focus_msg', focus)
      router.replace(`/home?${p.toString()}`)
    })
    return () => {
      if (typeof unsub === 'function') unsub()
    }
  }, [router])

  return null
}
