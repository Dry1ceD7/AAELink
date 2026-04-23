'use client'

import { useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { Logo } from '@/components/brand/logo'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { hasRole, useAuthStore } from '@/lib/store'
import { useUIStore } from '@/lib/ui-store'

export function DashboardHeader() {
  const t = useTranslations()
  const router = useRouter()
  const { user, logout } = useAuthStore()
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)

  const onLogout = async () => {
    await logout()
    router.replace('/login')
  }

  const initials = (user?.display_name ?? user?.email ?? '?')
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  const isAdmin = hasRole(user, 'it_admin')

  return (
    <header className="flex items-center justify-between gap-4 px-4 sm:px-6 py-3 border-b border-[color:var(--border)] bg-[color:var(--surface)]">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={toggleSidebar}
          className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-md border border-[color:var(--border)] text-[color:var(--fg)]"
          aria-label="Menu"
        >
          ☰
        </button>
        <Logo size={28} withWordmark />
      </div>
      <div className="flex items-center gap-2">
        {isAdmin && (
          <Link href="/admin" className="hidden sm:inline-flex">
            <Button variant="outline" size="sm">
              🛡️ {t('admin.title')}
            </Button>
          </Link>
        )}
        <LocaleSwitcher />
        <ThemeToggle />
        {user && (
          <div className="flex items-center gap-2 pl-2 border-l border-[color:var(--border)]">
            <div
              className="h-8 w-8 rounded-full bg-[color:var(--accent)] text-white flex items-center justify-center text-xs font-semibold"
              aria-hidden
            >
              {initials || '?'}
            </div>
            <div className="hidden sm:flex flex-col leading-tight">
              <span className="text-sm font-medium text-[color:var(--fg)]">
                {user.display_name}
              </span>
              <span className="text-xs text-[color:var(--muted)]">
                {user.email}
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={onLogout}>
              {t('auth.logout')}
            </Button>
          </div>
        )}
      </div>
    </header>
  )
}
