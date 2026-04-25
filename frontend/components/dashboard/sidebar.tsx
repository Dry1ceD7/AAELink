'use client'

import type { ComponentType, SVGProps } from 'react'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown, FileText, Home, Ticket, X } from 'lucide-react'
import { Link, usePathname } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/lib/ui-store'
import { APP_VERSION_LABEL } from '@/lib/version'

type IconType = ComponentType<SVGProps<SVGSVGElement>>

interface NavItem {
  href: string
  labelKey: string
  Icon: IconType
}

interface NavSection {
  id: string
  labelKey: string
  items: NavItem[]
}

// AAELink ships as a multi-module super app. The sidebar now only carries
// global modules. Module-specific entry points (e.g. "+ New Ticket") live
// inside their owning module — never in this global navigation rail —
// so the chrome stays clean as new modules ship.
const sections: NavSection[] = [
  {
    id: 'workspace',
    labelKey: 'sidebar.workspace',
    items: [
      { href: '/dashboard', labelKey: 'nav.dashboard', Icon: Home },
      { href: '/tickets', labelKey: 'nav.tickets', Icon: Ticket },
      { href: '/documents', labelKey: 'nav.documents', Icon: FileText },
    ],
  },
]

export function Sidebar() {
  const t = useTranslations()
  const pathname = usePathname() ?? ''
  const { sidebarOpen, closeSidebar } = useUIStore()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  useEffect(() => {
    closeSidebar()
  }, [pathname, closeSidebar])

  const toggle = (id: string) =>
    setCollapsed((s) => ({ ...s, [id]: !s[id] }))

  const renderLink = (it: NavItem) => {
    const active =
      pathname === it.href ||
      (it.href !== '/dashboard' && pathname.startsWith(it.href + '/'))
    return (
      <Link
        key={it.href}
        href={it.href}
        onClick={closeSidebar}
        className={cn(
          'group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors',
          active
            ? 'bg-[color:var(--accent)]/12 text-[color:var(--accent)] font-medium'
            : 'text-[color:var(--fg)] hover:bg-[color:var(--border)]/40',
        )}
      >
        <it.Icon
          className={cn(
            'h-4 w-4 shrink-0',
            active
              ? 'text-[color:var(--accent)]'
              : 'text-[color:var(--muted)] group-hover:text-[color:var(--fg)]',
          )}
          aria-hidden
        />
        <span className="truncate">{t(it.labelKey)}</span>
      </Link>
    )
  }

  const Inner = (
    <>
      <nav className="flex-1 px-2 pt-3 pb-3 space-y-3 overflow-y-auto">
        {sections.map((section) => {
          const isClosed = collapsed[section.id]
          return (
            <div key={section.id}>
              <button
                type="button"
                onClick={() => toggle(section.id)}
                aria-expanded={!isClosed}
                className="group flex w-full items-center justify-between px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted)] hover:text-[color:var(--fg)]"
              >
                <span>{t(section.labelKey)}</span>
                <ChevronDown
                  className={cn(
                    'h-3 w-3 transition-transform',
                    isClosed && '-rotate-90',
                  )}
                  aria-hidden
                />
              </button>
              {!isClosed && (
                <div className="mt-0.5 space-y-0.5">
                  {section.items.map(renderLink)}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      <div className="px-4 py-2.5 border-t border-[color:var(--border)] text-[11px] text-[color:var(--muted)]">
        AAELink {APP_VERSION_LABEL}
      </div>
    </>
  )

  return (
    <>
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-[color:var(--border)] bg-[color:var(--surface)]">
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
