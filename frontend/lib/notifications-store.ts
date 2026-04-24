'use client'

import { useSyncExternalStore } from 'react'

import type { Ticket } from './types'

// Live in-app notifications feed. The notifications panel reads from this
// store; the SSE listener (notifications-listener.tsx) writes to it. We
// keep state outside React (singleton) so the bell badge works even if
// the panel is currently closed and unmounted.

export type NotificationKind =
  | 'ticket.created'
  | 'ticket.status_changed'
  | 'ticket.assigned'
  | 'ticket.comment_added'

export interface NotificationItem {
  id: string
  kind: NotificationKind
  ticketId: string
  ticketNumber?: number
  title: string
  body: string
  createdAt: number
  unread: boolean
}

interface State {
  items: NotificationItem[]
  /** Cap kept short so the panel stays snappy. */
  cap: number
}

let state: State = { items: [], cap: 50 }
const listeners = new Set<() => void>()

function emit() {
  for (const fn of listeners) fn()
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function snapshot(): State {
  return state
}

const SERVER_FALLBACK: State = { items: [], cap: 50 }

export function useNotifications(): State {
  return useSyncExternalStore(subscribe, snapshot, () => SERVER_FALLBACK)
}

export function useUnreadNotificationCount(): number {
  const s = useNotifications()
  return s.items.reduce((acc, it) => acc + (it.unread ? 1 : 0), 0)
}

export function pushNotification(item: Omit<NotificationItem, 'id' | 'createdAt' | 'unread'>) {
  const next: NotificationItem = {
    ...item,
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    unread: true,
  }
  state = {
    ...state,
    items: [next, ...state.items].slice(0, state.cap),
  }
  emit()
}

export function markAllRead() {
  state = {
    ...state,
    items: state.items.map((it) => ({ ...it, unread: false })),
  }
  emit()
}

export function clearNotifications() {
  state = { ...state, items: [] }
  emit()
}

// Helpers ────────────────────────────────────────────────────────────────

export function notificationFromTicketEvent(
  kind: NotificationKind,
  ticket: Ticket | null,
  fallback: { ticketId: string; title?: string },
): Omit<NotificationItem, 'id' | 'createdAt' | 'unread'> {
  const ticketId = ticket?.id ?? fallback.ticketId
  const number = ticket?.number
  const title = ticket?.title ?? fallback.title ?? ''
  const tag = number ? `#${number}` : ticketId.slice(0, 8)
  switch (kind) {
    case 'ticket.created':
      return {
        kind,
        ticketId,
        ticketNumber: number,
        title: `New ticket ${tag}`,
        body: title,
      }
    case 'ticket.status_changed':
      return {
        kind,
        ticketId,
        ticketNumber: number,
        title: `Ticket ${tag} updated`,
        body: ticket?.status ? `Status: ${ticket.status}` : title,
      }
    case 'ticket.assigned':
      return {
        kind,
        ticketId,
        ticketNumber: number,
        title: `Ticket ${tag} assigned`,
        body: title,
      }
    case 'ticket.comment_added':
      return {
        kind,
        ticketId,
        ticketNumber: number,
        title: `New comment on ${tag}`,
        body: title,
      }
  }
}
