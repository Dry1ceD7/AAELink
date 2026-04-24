'use client'

import { useEffect } from 'react'

import { tokenStorage } from '@/lib/api'
import {
  notificationFromTicketEvent,
  pushNotification,
  type NotificationKind,
} from '@/lib/notifications-store'
import { usePreferences } from '@/lib/settings-store'
import { useAuthStore } from '@/lib/store'

interface IncomingEvent {
  type?: string
  ticket_id?: string
  actor?: string
  payload?: {
    id?: string
    number?: number
    title?: string
    status?: string
    priority?: string
    created_by?: string
    assigned_to?: string | null
    department_id?: string | null
  }
}

const KNOWN: Record<string, NotificationKind> = {
  'ticket.created': 'ticket.created',
  'ticket.status_changed': 'ticket.status_changed',
  'ticket.assigned': 'ticket.assigned',
  'ticket.comment_added': 'ticket.comment_added',
}

// NotificationsListener wires the global ticket SSE feed into the
// in-app notifications store. Server-side filtering already enforces
// per-user isolation; we only suppress events the current user
// triggered themselves so the actor never sees their own action as a
// new alert. Optional native desktop notifications honor the user's
// "Desktop notifications" preference.
export function NotificationsListener() {
  const user = useAuthStore((s) => s.user)
  const isHydrated = useAuthStore((s) => s.isHydrated)
  const prefs = usePreferences()

  useEffect(() => {
    if (!isHydrated || !user) return
    const access = tokenStorage.getAccess()
    if (!access) return

    const url = `/api/v1/tickets/stream?token=${encodeURIComponent(access)}`
    let es: EventSource | null = null
    let cancelled = false

    // Some browsers don't allow custom headers on EventSource. We pass
    // the token as a query string ONLY for SSE (the rest of the API uses
    // Authorization). Backends that don't accept query tokens still get
    // the cookie-less behavior.
    try {
      es = new EventSource(url, { withCredentials: false })
    } catch {
      return
    }

    function emit(ev: MessageEvent) {
      if (cancelled || !user) return
      let data: IncomingEvent
      try {
        data = JSON.parse(ev.data)
      } catch {
        return
      }
      const kind = KNOWN[data.type ?? '']
      if (!kind) return
      // Don't notify on own actions.
      if (data.actor && data.actor === user.id) return

      const ticketId = data.ticket_id || data.payload?.id || ''
      if (!ticketId) return

      const ticket = data.payload
        ? {
          id: data.payload.id ?? ticketId,
          number: data.payload.number ?? 0,
          title: data.payload.title ?? '',
          description: '',
          status: (data.payload.status as never) ?? 'open',
          priority: (data.payload.priority as never) ?? 'medium',
          created_by: data.payload.created_by ?? '',
          assigned_to: data.payload.assigned_to ?? null,
          department_id: data.payload.department_id ?? null,
          created_at: '',
          updated_at: '',
        }
        : null

      const item = notificationFromTicketEvent(kind, ticket as never, {
        ticketId,
        title: data.payload?.title,
      })
      pushNotification(item)

      if (
        prefs.notifyDesktop &&
        typeof window !== 'undefined' &&
        'Notification' in window
      ) {
        try {
          if (window.Notification.permission === 'granted') {
            new window.Notification(item.title, { body: item.body })
          } else if (window.Notification.permission === 'default') {
            void window.Notification.requestPermission()
          }
        } catch {
          // ignore: some browsers throw when calling Notification in
          // unsecured contexts; our internal HTTP deployment is fine.
        }
      }
    }

    es.addEventListener('ticket', emit)
    es.addEventListener('error', () => {
      // EventSource will auto-reconnect; do nothing.
    })

    return () => {
      cancelled = true
      es?.removeEventListener('ticket', emit)
      es?.close()
    }
  }, [isHydrated, user, prefs.notifyDesktop])

  return null
}
