'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Bell } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import { hrefForNotification } from '@/lib/notifications/notificationHref'
import {
  AAELINK_NOTIFICATIONS_BC,
  AAELINK_NOTIFICATIONS_INVALIDATE,
  invalidateClientNotifications
} from '@/lib/notifications/notificationInvalidate'
import { showSystemNotificationIfAllowed } from '@/lib/notifications/nativeNotify'
import { connectNotificationStream } from '@/lib/notifications/notificationStream'
import type { ApiNotification } from '@/lib/notifications/notificationTypes'

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
  if (diff < 172800_000) return 'yesterday'
  if (diff < 604800_000) return `${Math.floor(diff / 86400_000)}d ago`
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function NotificationsBell({ enabled }: { enabled: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<ApiNotification[]>([])
  const [unread, setUnread] = useState(0)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ title: string; id: string } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [popoverFixed, setPopoverFixed] = useState<{ left: number; top: number } | null>(null)
  const prevUnread = useRef(0)
  const firstPoll = useRef(true)
  const priorFocusBeforePopoverRef = useRef<HTMLElement | null>(null)
  const toastTimer = useRef<number | null>(null)
  const systemNotifyEnabledRef = useRef(true)
  const nativeDedupeRef = useRef<{ id: string; at: number }>({ id: '', at: 0 })
  const enabledRef = useRef(enabled)
  const loadRunningRef = useRef(false)
  const loadAgainRef = useRef(false)
  const [filter, setFilter] = useState<'all' | 'unread' | 'mentions'>('all')
  enabledRef.current = enabled

  const refreshPrefs = useCallback(async () => {
    const res = await apiFetch('/api/auth/notification-prefs')
    if (!res.ok) return
    try {
      const data = (await res.json()) as { system_notifications_enabled?: boolean }
      systemNotifyEnabledRef.current = data.system_notifications_enabled !== false
    } catch {
      /* ignore */
    }
  }, [])

  const tryShowNative = useCallback((n: ApiNotification) => {
    const now = Date.now()
    const d = nativeDedupeRef.current
    if (d.id === n.id && now - d.at < 5000) return
    nativeDedupeRef.current = { id: n.id, at: now }
    showSystemNotificationIfAllowed(n, systemNotifyEnabledRef.current)
  }, [])

  const load = useCallback(async () => {
    if (!enabledRef.current) return
    if (loadRunningRef.current) {
      loadAgainRef.current = true
      return
    }
    loadRunningRef.current = true
    try {
      do {
        loadAgainRef.current = false
        if (!enabledRef.current) break
        const res = await apiFetch('/api/notifications')
        if (!enabledRef.current) break
        if (!res.ok) break
        const data = (await res.json()) as { notifications?: ApiNotification[]; unread_count?: number }
        const list = data.notifications ?? []
        const u = Number(data.unread_count) || 0
        setItems(list)
        if (firstPoll.current) {
          firstPoll.current = false
          prevUnread.current = u
        } else {
          try {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden' && u > prevUnread.current) {
              const latest = list.find(x => (x.read_at ?? 0) === 0)
              if (latest) tryShowNative(latest)
            }
          } catch {
            /* ignore */
          }
          prevUnread.current = u
        }
        setUnread(u)
      } while (loadAgainRef.current)
    } finally {
      loadRunningRef.current = false
    }
  }, [tryShowNative])

  useEffect(() => {
    if (!enabled) return
    void refreshPrefs()
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        void refreshPrefs()
        void load()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [enabled, refreshPrefs, load])

  useEffect(() => {
    if (!enabled) return
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        void refreshPrefs()
        void load()
      }
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [enabled, refreshPrefs, load])

  useEffect(() => {
    const apply = (data: { type?: string; unread_count?: number } | undefined) => {
      if (data?.type != null && data.type !== 'invalidate') return
      if (typeof data?.unread_count === 'number' && Number.isFinite(data.unread_count)) setUnread(data.unread_count)
      void load()
    }
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const bc = new BroadcastChannel(AAELINK_NOTIFICATIONS_BC)
        bc.onmessage = (ev: MessageEvent<{ type?: string; unread_count?: number }>) => {
          apply(ev.data)
        }
        return () => bc.close()
      } catch {
        /* fall through to CustomEvent */
      }
    }
    const onInv = (ev: Event) => apply((ev as CustomEvent<{ type?: string; unread_count?: number }>).detail)
    window.addEventListener(AAELINK_NOTIFICATIONS_INVALIDATE, onInv)
    return () => window.removeEventListener(AAELINK_NOTIFICATIONS_INVALIDATE, onInv)
  }, [load])

  useEffect(() => {
    if (!enabled) return
    void load()
    const id = window.setInterval(() => void load(), 45_000)
    return () => window.clearInterval(id)
  }, [enabled, load])

  useEffect(() => {
    if (!enabled) return
    const stop = connectNotificationStream(p => {
      setUnread(p.unread_count)
      void load()
      const lat = p.latest
      if (!lat || (lat.read_at ?? 0) !== 0) return
      if (typeof document === 'undefined') return
      if (document.visibilityState === 'visible') {
        setToast({ title: lat.title, id: lat.id })
        if (toastTimer.current != null) window.clearTimeout(toastTimer.current)
        toastTimer.current = window.setTimeout(() => setToast(null), 5200)
      } else {
        tryShowNative(lat)
      }
    })
    return () => {
      stop()
      if (toastTimer.current != null) window.clearTimeout(toastTimer.current)
    }
  }, [enabled, load, tryShowNative])

  const recomputePopoverAnchor = useCallback(() => {
    const wrap = wrapRef.current
    if (!wrap || !open) return
    const r = wrap.getBoundingClientRect()
    setPopoverFixed({ left: r.left + r.width / 2, top: r.bottom + 8 })
  }, [open])

  useLayoutEffect(() => {
    if (!open) {
      setPopoverFixed(null)
      return
    }
    recomputePopoverAnchor()
    const on = () => recomputePopoverAnchor()
    window.addEventListener('resize', on)
    window.addEventListener('scroll', on, true)
    return () => {
      window.removeEventListener('resize', on)
      window.removeEventListener('scroll', on, true)
    }
  }, [open, recomputePopoverAnchor])

  useLayoutEffect(() => {
    if (open && popoverFixed) {
      const id = window.requestAnimationFrame(() => {
        const root = popoverRef.current
        if (!root) return
        const markAll = root.querySelector<HTMLElement>('.mm-notif-markall')
        if (markAll && !markAll.hasAttribute('disabled')) {
          markAll.focus()
          return
        }
        const firstRow = root.querySelector<HTMLElement>('.mm-notif-row')
        if (firstRow) {
          firstRow.focus()
          return
        }
        root.focus()
      })
      return () => window.cancelAnimationFrame(id)
    }
    if (!open) {
      const el = priorFocusBeforePopoverRef.current
      priorFocusBeforePopoverRef.current = null
      if (el && document.contains(el)) {
        try {
          el.focus({ preventScroll: true })
        } catch {
          /* ignore */
        }
      }
    }
  }, [open, popoverFixed])

  useEffect(() => {
    if (!open || !popoverFixed) return
    const panel = popoverRef.current
    if (!panel) return

    const focusables = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter(el => el.offsetParent !== null || el === document.activeElement)

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const active = document.activeElement
      if (!active || !panel.contains(active)) return
      const nodes = focusables()
      if (nodes.length === 0) return
      if (nodes.length === 1) {
        e.preventDefault()
        nodes[0].focus()
        return
      }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (e.shiftKey) {
        if (active === first) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open, popoverFixed, items.length, unread])

  useEffect(() => {
    if (!open) return
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    }
    window.addEventListener('keydown', onEsc, true)
    return () => window.removeEventListener('keydown', onEsc, true)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t)) return
      if (popoverRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  async function requestNotifyPermission() {
    if (typeof Notification === 'undefined' || Notification.permission !== 'default') return
    try {
      await Notification.requestPermission()
    } catch {
      /* ignore */
    }
  }

  async function markRead(ids: string[]) {
    if (ids.length === 0) return
    setBusy(true)
    const res = await apiFetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    })
    setBusy(false)
    if (res.ok) {
      const now = Date.now()
      setItems(prev => prev.map(n => (ids.includes(n.id) ? { ...n, read_at: now } : n)))
      try {
        const j = (await res.json()) as { unread_count?: number }
        invalidateClientNotifications(
          typeof j.unread_count === 'number' ? { unread_count: j.unread_count } : undefined
        )
      } catch {
        invalidateClientNotifications()
      }
    } else void load()
  }

  async function markAllRead() {
    setBusy(true)
    const res = await apiFetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read_all: true })
    })
    setBusy(false)
    if (res.ok) {
      const now = Date.now()
      setItems(prev => prev.map(n => ({ ...n, read_at: now })))
      try {
        const j = (await res.json()) as { unread_count?: number }
        invalidateClientNotifications(
          typeof j.unread_count === 'number' ? { unread_count: j.unread_count } : undefined
        )
      } catch {
        invalidateClientNotifications()
      }
    } else void load()
  }

  function onPick(n: ApiNotification) {
    const path = hrefForNotification(n)
    void markRead([n.id])
    setOpen(false)
    router.push(path)
  }

  if (!enabled) return null

  const popoverPanel =
    open && popoverFixed ? (
      <div
        ref={popoverRef}
        className="mm-notif-popover mm-notif-popover-portal"
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
        tabIndex={-1}
        style={{
          position: 'fixed',
          left: popoverFixed.left,
          top: popoverFixed.top,
          transform: 'translateX(-50%)',
          maxHeight: `calc(100vh - ${popoverFixed.top + 16}px)`
        }}
      >
      <div className="mm-notif-popover-head">
          <span>Notifications</span>
          {unread > 0 ? (
            <button type="button" className="mm-notif-markall" disabled={busy} onClick={() => void markAllRead()}>
              Mark all read
            </button>
          ) : null}
        </div>
        <div className="mm-notif-filter-tabs">
          <button type="button" className={`mm-notif-filter-tab${filter === 'all' ? ' mm-notif-filter-tab--active' : ''}`} onClick={() => setFilter('all')}>All</button>
          <button type="button" className={`mm-notif-filter-tab${filter === 'unread' ? ' mm-notif-filter-tab--active' : ''}`} onClick={() => setFilter('unread')}>Unread{unread > 0 ? ` (${unread})` : ''}</button>
          <button type="button" className={`mm-notif-filter-tab${filter === 'mentions' ? ' mm-notif-filter-tab--active' : ''}`} onClick={() => setFilter('mentions')}>Mentions</button>
        </div>
        <div className="mm-notif-list">
          {(() => {
            let filtered = items
            if (filter === 'unread') filtered = items.filter(n => (n.read_at ?? 0) === 0)
            if (filter === 'mentions') filtered = items.filter(n => n.kind === 'mention' || n.kind === 'dm' || (n.title && n.title.toLowerCase().includes('mention')))
            if (filtered.length === 0) {
              return <p className="mm-notif-empty">{filter === 'all' ? 'No notifications yet.' : `No ${filter} notifications.`}</p>
            }
            return filtered.map(n => {
              const isUnread = (n.read_at ?? 0) === 0
              return (
                <button
                  key={n.id}
                  type="button"
                  className={`mm-notif-row${isUnread ? ' mm-notif-row--unread' : ''}`}
                  onClick={() => onPick(n)}
                >
                  <span className="mm-notif-row-title">{n.title}</span>
                  <span className="mm-notif-row-body">{n.body}</span>
                  <span className="mm-notif-row-meta">
                    {relativeTime(n.created_at)}
                  </span>
                </button>
              )
            })
          })()}
        </div>
      </div>
    ) : null

  return (
    <>
      {toast && typeof document !== 'undefined'
        ? createPortal(
            <div className="mm-notif-toast" role="status" aria-live="polite">
              <span className="mm-notif-toast-title">{toast.title}</span>
              <button type="button" className="mm-notif-toast-dismiss" onClick={() => setToast(null)} aria-label="Dismiss">
                Dismiss
              </button>
            </div>,
            document.body
          )
        : null}
      <div className="mm-notif-wrap" ref={wrapRef}>
        <button
          type="button"
          className="mm-icon-btn mm-notif-trigger"
          title="Notifications"
          aria-label="Notifications"
          aria-expanded={open}
          onClick={() => {
            void requestNotifyPermission()
            void refreshPrefs()
            setOpen(v => {
              const next = !v
              if (next) {
                const a = document.activeElement
                priorFocusBeforePopoverRef.current = a instanceof HTMLElement ? a : null
              }
              return next
            })
            void load()
          }}
        >
          <Bell size={18} aria-hidden="true" />
          {unread > 0 ? (
            <span className="mm-notif-badge" aria-label={`${unread} unread`}>
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </button>
      </div>
      {popoverPanel && typeof document !== 'undefined' ? createPortal(popoverPanel, document.body) : null}
    </>
  )
}
