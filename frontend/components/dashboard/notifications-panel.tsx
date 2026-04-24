'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Bell, Check, MailCheck, Settings as SettingsIcon } from 'lucide-react'

import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/lib/ui-store'
import {
  clearNotifications,
  markAllRead,
  useNotifications,
} from '@/lib/notifications-store'
import { usePreferences, setPreferences } from '@/lib/settings-store'

export function NotificationsPanel() {
  const t = useTranslations()
  const { notificationsOpen, closeNotifications } = useUIStore()
  const wrapRef = useRef<HTMLDivElement>(null)
  const prefs = usePreferences()
  const { items } = useNotifications()

  useEffect(() => {
    if (!notificationsOpen) return
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(e.target as Node)) closeNotifications()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeNotifications()
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [notificationsOpen, closeNotifications])

  // Mark everything seen the moment the panel opens, so the bell badge
  // resets immediately. Items remain visible in the list (just no longer
  // accent-tinted) until the user explicitly clears them.
  useEffect(() => {
    if (notificationsOpen) markAllRead()
  }, [notificationsOpen])

  if (!notificationsOpen) return null

  return (
    <div
      ref={wrapRef}
      className="absolute right-0 top-full z-50 mt-2 w-[360px] max-w-[92vw] overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] shadow-xl"
    >
      <div className="flex items-center justify-between gap-2 border-b border-[color:var(--border)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-[color:var(--muted)]" />
          <span className="text-sm font-semibold text-[color:var(--fg)]">
            {t('notifications.title')}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => clearNotifications()}
              className="text-xs text-[color:var(--muted)] hover:text-[color:var(--fg)]"
            >
              {t('notifications.clear')}
            </button>
          )}
          <button
            type="button"
            onClick={() => setPreferences({ notifyDesktop: !prefs.notifyDesktop })}
            className="inline-flex items-center gap-1 text-xs text-[color:var(--muted)] hover:text-[color:var(--fg)]"
            title={t('settings.notifyDesktopDesc')}
          >
            <SettingsIcon className="h-3.5 w-3.5" />
            {prefs.notifyDesktop
              ? t('notifications.muted.off')
              : t('notifications.muted.on')}
          </button>
        </div>
      </div>

      <div className="max-h-[60vh] overflow-y-auto">
        {items.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--accent)]/10 text-[color:var(--accent)]">
              <Check className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium text-[color:var(--fg)]">
              {t('notifications.allCaughtUp')}
            </p>
            <p className="mt-1 text-xs text-[color:var(--muted)]">
              {t('notifications.allCaughtUpHint')}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[color:var(--border)]">
            {items.map((n) => (
              <li
                key={n.id}
                className={cn(
                  'px-4 py-3 text-sm hover:bg-[color:var(--border)]/30',
                  n.unread && 'bg-[color:var(--accent)]/5',
                )}
              >
                <Link
                  href={`/tickets/${n.ticketId}`}
                  onClick={closeNotifications}
                  className="block min-w-0"
                >
                  <p className="font-medium text-[color:var(--fg)] truncate">
                    {n.title}
                  </p>
                  {n.body && (
                    <p className="mt-0.5 text-xs text-[color:var(--muted)] truncate">
                      {n.body}
                    </p>
                  )}
                  <p className="mt-0.5 text-[10px] uppercase tracking-wider text-[color:var(--muted)]">
                    {formatTime(n.createdAt)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[color:var(--border)] px-4 py-2 text-xs text-[color:var(--muted)]">
        <span className="inline-flex items-center gap-1">
          <MailCheck className="h-3.5 w-3.5" />
          {prefs.notifyEmail
            ? t('notifications.emailOn')
            : t('notifications.emailOff')}
        </span>
        <button
          type="button"
          onClick={() => setPreferences({ notifyEmail: !prefs.notifyEmail })}
          className="text-[color:var(--accent)] hover:underline"
        >
          {prefs.notifyEmail
            ? t('notifications.disableEmail')
            : t('notifications.enableEmail')}
        </button>
      </div>
    </div>
  )
}

function formatTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts)
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  return new Date(ts).toLocaleDateString()
}
