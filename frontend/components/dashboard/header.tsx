'use client'

import { useTranslations } from 'next-intl'
import { Bell, Menu } from 'lucide-react'

import { Logo } from '@/components/brand/logo'
import { ThemeToggle } from '@/components/theme-toggle'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { UserMenu } from '@/components/dashboard/user-menu'
import { BackButton } from '@/components/dashboard/back-button'
import { NotificationsPanel } from '@/components/dashboard/notifications-panel'
import { useUnreadNotificationCount } from '@/lib/notifications-store'
import { useUIStore } from '@/lib/ui-store'
import { cn } from '@/lib/utils'

export function DashboardHeader() {
  const t = useTranslations()
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const toggleNotifications = useUIStore((s) => s.toggleNotifications)
  const notificationsOpen = useUIStore((s) => s.notificationsOpen)
  const unread = useUnreadNotificationCount()

  return (
    <header className="relative shrink-0 flex items-center gap-3 px-3 sm:px-4 py-2 border-b border-[color:var(--border)] bg-[color:var(--surface)]">
      <div className="flex items-center gap-1.5 min-w-0">
        <button
          type="button"
          onClick={toggleSidebar}
          className="md:hidden inline-flex h-8 w-8 items-center justify-center rounded-md text-[color:var(--fg)] hover:bg-[color:var(--border)]/40"
          aria-label={t('common.openMenu')}
        >
          <Menu className="h-4 w-4" />
        </button>
        <BackButton />
        <div className="hidden sm:block ml-1">
          <Logo size={24} withWordmark />
        </div>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-1">
        <LocaleSwitcher />
        <ThemeToggle />
        <div className="relative">
          <button
            type="button"
            onClick={toggleNotifications}
            aria-label={t('notifications.title')}
            aria-expanded={notificationsOpen}
            className={cn(
              'relative inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors',
              notificationsOpen
                ? 'bg-[color:var(--accent)]/10 text-[color:var(--accent)]'
                : 'text-[color:var(--muted)] hover:text-[color:var(--fg)] hover:bg-[color:var(--border)]/40',
            )}
          >
            <Bell className="h-4 w-4" />
            {unread > 0 && (
              <span
                className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white"
                aria-label={t('notifications.unreadCount', { count: unread })}
              >
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>
          <NotificationsPanel />
        </div>
        <div className="ml-1">
          <UserMenu />
        </div>
      </div>
    </header>
  )
}
