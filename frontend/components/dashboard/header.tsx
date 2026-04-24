'use client'

import { useTranslations } from 'next-intl'
import { Menu, ShieldCheck } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { Logo } from '@/components/brand/logo'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { UserMenu } from '@/components/dashboard/user-menu'
import { hasRole, useAuthStore } from '@/lib/store'
import { useUIStore } from '@/lib/ui-store'

export function DashboardHeader() {
  const t = useTranslations()
  const { user } = useAuthStore()
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const isAdmin = hasRole(user, 'it_admin')

  return (
    <header className="flex items-center justify-between gap-4 px-4 sm:px-6 py-3 border-b border-[color:var(--border)] bg-[color:var(--surface)]">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={toggleSidebar}
          className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-md border border-[color:var(--border)] text-[color:var(--fg)] hover:bg-[color:var(--border)]/40"
          aria-label="Menu"
        >
          <Menu className="h-4 w-4" />
        </button>
        <Logo size={28} withWordmark />
      </div>
      <div className="flex items-center gap-2">
        {isAdmin && (
          <Link href="/admin" className="hidden sm:inline-flex">
            <Button variant="outline" size="sm" className="gap-2">
              <ShieldCheck className="h-4 w-4" />
              {t('admin.title')}
            </Button>
          </Link>
        )}
        <LocaleSwitcher />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  )
}
