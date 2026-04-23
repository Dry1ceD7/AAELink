'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { hasRole, useAuthStore } from '@/lib/store'

interface NavItem {
  href: string
  labelKey: string
  icon: string
  roles?: string[]
}

const items: NavItem[] = [
  { href: '/dashboard', labelKey: 'nav.dashboard', icon: '🏠' },
  { href: '/tickets', labelKey: 'nav.tickets', icon: '🎫' },
  { href: '/tickets/new', labelKey: 'nav.newTicket', icon: '➕' },
  {
    href: '/admin/users',
    labelKey: 'nav.users',
    icon: '👥',
    roles: ['it_admin'],
  },
  {
    href: '/admin/departments',
    labelKey: 'nav.departments',
    icon: '🏢',
    roles: ['it_admin'],
  },
]

export function Sidebar() {
  const t = useTranslations()
  const pathname = usePathname() ?? ''
  const user = useAuthStore((s) => s.user)

  const normalized = pathname.replace(/^\/(en|th|de)(?=\/|$)/, '') || '/'

  return (
    <aside className="hidden md:flex w-60 flex-col border-r border-[color:var(--border)] bg-[color:var(--surface)]">
      <nav className="flex-1 px-3 py-4 space-y-1">
        {items.map((it) => {
          if (it.roles && !hasRole(user, ...it.roles)) return null
          const active =
            normalized === it.href ||
            (it.href !== '/dashboard' && normalized.startsWith(it.href))
          return (
            <Link
              key={it.href}
              href={it.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-[color:var(--accent)]/10 text-[color:var(--accent)] font-medium'
                  : 'text-[color:var(--fg)] hover:bg-[color:var(--border)]/40',
              )}
            >
              <span className="text-base leading-none">{it.icon}</span>
              <span>{t(it.labelKey)}</span>
            </Link>
          )
        })}
      </nav>
      <div className="px-4 py-3 border-t border-[color:var(--border)] text-xs text-[color:var(--muted)]">
        AAELink v0.8
      </div>
    </aside>
  )
}
