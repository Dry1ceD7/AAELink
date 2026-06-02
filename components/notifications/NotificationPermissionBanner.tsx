'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bell, X } from 'lucide-react'

const DISMISSED_KEY = 'aaelink-notif-banner-dismissed'

/**
 * A banner that prompts users to enable browser notifications.
 * Shows only when:
 *  1. The browser supports notifications
 *  2. Permission is 'default' (not yet asked)
 *  3. The user hasn't dismissed the banner
 */
export function NotificationPermissionBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof Notification === 'undefined') return
    if (Notification.permission !== 'default') return
    const dismissed = localStorage.getItem(DISMISSED_KEY)
    if (dismissed === 'true') return
    setVisible(true)
  }, [])

  const handleEnable = useCallback(async () => {
    try {
      const result = await Notification.requestPermission()
      if (result === 'granted' || result === 'denied') {
        setVisible(false)
      }
    } catch {
      setVisible(false)
    }
  }, [])

  const handleDismiss = useCallback(() => {
    localStorage.setItem(DISMISSED_KEY, 'true')
    setVisible(false)
  }, [])

  if (!visible) return null

  return (
    <div className="notif-permission-banner" role="banner">
      <Bell size={18} style={{ color: 'var(--aae-accent, var(--aae-link))', flexShrink: 0 }} />
      <span className="notif-banner-text">
        <strong>Enable notifications</strong> to stay updated with messages and mentions even when AAELink isn't in focus.
      </span>
      <button type="button" className="notif-banner-enable" onClick={handleEnable}>
        Enable
      </button>
      <button type="button" className="notif-banner-dismiss" onClick={handleDismiss} aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  )
}
