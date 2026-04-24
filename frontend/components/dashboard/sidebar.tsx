'use client'

import type { ComponentType, SVGProps } from 'react'
import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import {
  Building2,
  Home,
  Plus,
  Settings,
  ShieldCheck,
  Ticket,
  Users,
  X,
} from 'lucide-react'
import { Link, usePathname } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import { hasRole, useAuthStore } from '@/lib/store'
import { useUIStore } from '@/lib/ui-store'
import { APP_VERSION_LABEL } from '@/lib/version'

type IconType = ComponentType<SVGProps<SVGSVGElement>>

interface NavItem {
  href: string
  labelKey: string
  Icon: IconType
  roles?: string[]
  group?: 'main' | 'admin'
}

const items: NavItem[] = [
  { href: '/dashboard', labelKey: 'nav.dashboard', Icon: Home, group: 'main' },
  { href: '/tickets', labelKey: 'nav.tickets', Icon: Ticket, group: 'main' },
  { href: '/tickets/new', labelKey: 'nav.newTicket', Icon: Plus, group: 'main' },
  { href: '/settings', labelKey: 'nav.settings', Icon: Settings, group: 'main' },
  {
    href: '/admin',
    labelKey: 'admin.title',
    Icon: ShieldCheck,
    roles: ['it_admin'],
    group: 'admin',
  },
  {
    href: '/admin/users',
    labelKey: 'nav.users',
    Icon: Users,
    roles: ['it_admin'],
    group: 'admin',
  },
  {
    href: '/admin/departments',
    labelKey: 'nav.departments',
    Icon: Building2,
    roles: ['it_admin'],
    group: 'admin',
  },
  {
    href: '/admin/system',
    labelKey: 'nav.system',
    Icon: Settings,
    roles: ['it_admin'],
    group: 'admin',
  },
]

export function Sidebar() {
  const t = useTranslations()
  const pathname = usePathname() ?? ''
  const user = useAuthStore((s) => s.user)
  const { sidebarOpen, closeSidebar } = useUIStore()

  useEffect(() => {
    closeSidebar()
  }, [pathname, closeSidebar])

  const visible = items.filter(
    (it) => !it.roles || hasRole(user, ...it.roles),
  )
  const main = visible.filter((it) => (it.group ?? 'main') === 'main')
  const admin = visible.filter((it) => it.group === 'admin')

  const renderLink = (it: NavItem) => {
    const active =
      pathname === it.href ||
      (it.href !== '/dashboard' && pathname.startsWith(it.href + '/')) ||
      (it.href !== '/dashboard' && pathname === it.href)
    return (
      <Link
        key={it.href}
        href={it.href}
        onClick={closeSidebar}
        className={cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
          active
            ? 'bg-[color:var(--accent)]/10 text-[color:var(--accent)] font-medium'
            : 'text-[color:var(--fg)] hover:bg-[color:var(--border)]/40',
        )}
      >
        <it.Icon className="h-4 w-4 shrink-0" aria-hidden />
        <span>{t(it.labelKey)}</span>
      </Link>
    )
  }

  const Inner = (
    <>
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <div className="space-y-1">{main.map(renderLink)}</div>
        {admin.length > 0 && (
          <div className="pt-4">
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted)]">
              {t('admin.title')}
            </p>
            <div className="space-y-1">{admin.map(renderLink)}</div>
          </div>
        )}
      </nav>
      <div className="px-4 py-3 border-t border-[color:var(--border)] text-xs text-[color:var(--muted)]">
        AAELink {APP_VERSION_LABEL}
      </div>
    </>
  )

  return (
    <>
      <aside className="hidden md:flex w-60 flex-col border-r border-[color:var(--border)] bg-[color:var(--surface)]">
        {Inner}
      </aside>

      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40"
          onClick={closeSidebar}
          aria-hidden
        />
      )}
      <aside
        className={cn(
          'md:hidden fixed inset-y-0 left-0 z-50 w-64 flex flex-col border-r border-[color:var(--border)] bg-[color:var(--surface)] transition-transform duration-200',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-hidden={!sidebarOpen}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--border)]">
          <span className="text-sm font-semibold text-[color:var(--fg)]">
            {t('app.name')}
          </span>
          <button
            type="button"
            onClick={closeSidebar}
            className="text-[color:var(--muted)] hover:text-[color:var(--fg)] inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-[color:var(--border)]/40"
            aria-label={t('common.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {Inner}
      </aside>
    </>
  )
}
