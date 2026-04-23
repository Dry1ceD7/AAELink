'use client'

import { useTranslations } from 'next-intl'

import { AdminGuard } from '@/components/admin-guard'
import { Link, usePathname } from '@/i18n/navigation'
import { cn } from '@/lib/utils'

interface Tab {
  href: string
  labelKey: string
}

const tabs: Tab[] = [
  { href: '/admin', labelKey: 'admin.title' },
  { href: '/admin/users', labelKey: 'admin.usersTitle' },
  { href: '/admin/departments', labelKey: 'admin.departmentsTitle' },
  { href: '/admin/system', labelKey: 'admin.systemTitle' },
]

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const t = useTranslations()
  const pathname = usePathname() ?? ''

  return (
    <AdminGuard>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-[color:var(--fg)]">
            {t('admin.title')}
          </h1>
          <p className="mt-1 text-sm text-[color:var(--muted)]">
            {t('admin.subtitle')}
          </p>
        </header>

        <nav className="flex flex-wrap gap-2 border-b border-[color:var(--border)] pb-2">
          {tabs.map((tab) => {
            const active =
              tab.href === '/admin'
                ? pathname === '/admin'
                : pathname.startsWith(tab.href)
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-[color:var(--accent)] text-white'
                    : 'text-[color:var(--fg)] hover:bg-[color:var(--surface)]',
                )}
              >
                {t(tab.labelKey)}
              </Link>
            )
          })}
        </nav>

        <div>{children}</div>
      </div>
    </AdminGuard>
  )
}
