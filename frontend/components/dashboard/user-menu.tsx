'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  ChevronDown,
  LogOut,
  Settings,
  ShieldCheck,
  UserCircle,
} from 'lucide-react'

import { Avatar } from '@/components/avatar'
import { Link, useRouter } from '@/i18n/navigation'
import { hasRole, useAuthStore } from '@/lib/store'
import { useUIStore } from '@/lib/ui-store'
import { cn } from '@/lib/utils'

export function UserMenu() {
  const t = useTranslations()
  const router = useRouter()
  const { user, logout } = useAuthStore()
  const openSettings = useUIStore((s) => s.openSettings)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  if (!user) return null

  const isAdmin = hasRole(user, 'it_admin')

  const onLogout = async () => {
    setOpen(false)
    await logout()
    router.replace('/login')
  }

  const closeAnd = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'flex items-center gap-2 rounded-md border border-transparent pl-1.5 pr-1 py-1 transition-colors',
          'hover:border-[color:var(--border)] hover:bg-[color:var(--surface)]',
        )}
      >
        <Avatar
          src={user.avatar_url ?? undefined}
          name={user.display_name}
          email={user.email}
          size={28}
        />
        <span className="hidden sm:flex flex-col leading-tight text-left">
          <span className="text-[13px] font-medium text-[color:var(--fg)] max-w-[160px] truncate">
            {user.display_name}
          </span>
          <span className="text-[11px] text-[color:var(--muted)] max-w-[160px] truncate">
            {user.email}
          </span>
        </span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 text-[color:var(--muted)] transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] shadow-xl"
        >
          <div className="flex items-center gap-3 px-4 py-3 border-b border-[color:var(--border)]">
            <Avatar
              src={user.avatar_url ?? undefined}
              name={user.display_name}
              email={user.email}
              size={40}
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[color:var(--fg)] truncate">
                {user.display_name}
              </p>
              <p className="text-xs text-[color:var(--muted)] truncate">
                {user.email}
              </p>
              {user.roles && user.roles.length > 0 && (
                <p className="mt-0.5 text-[11px] text-[color:var(--accent)]">
                  {user.roles.map((r) => t(`role.${r}`)).join(' · ')}
                </p>
              )}
            </div>
          </div>
          <nav className="py-1">
            <Link
              href="/profile"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-4 py-2 text-sm text-[color:var(--fg)] hover:bg-[color:var(--border)]/40"
            >
              <UserCircle className="h-4 w-4 text-[color:var(--muted)]" />
              {t('profile.title')}
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={closeAnd(openSettings)}
              className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-[color:var(--fg)] hover:bg-[color:var(--border)]/40"
            >
              <Settings className="h-4 w-4 text-[color:var(--muted)]" />
              {t('nav.settings')}
              <span className="ml-auto text-[11px] text-[color:var(--muted)]">
                {t('common.openInModal')}
              </span>
            </button>
            {isAdmin && (
              <Link
                href="/admin"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-4 py-2 text-sm text-[color:var(--fg)] hover:bg-[color:var(--border)]/40"
              >
                <ShieldCheck className="h-4 w-4 text-[color:var(--muted)]" />
                {t('admin.title')}
              </Link>
            )}
          </nav>
          <div className="border-t border-[color:var(--border)] py-1">
            <button
              type="button"
              role="menuitem"
              onClick={onLogout}
              className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-[color:var(--fg)] hover:bg-[color:var(--border)]/40"
            >
              <LogOut className="h-4 w-4 text-[color:var(--muted)]" />
              {t('auth.logout')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
