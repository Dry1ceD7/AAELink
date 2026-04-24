'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown, LogOut, Settings, UserCircle } from 'lucide-react'

import { Avatar } from '@/components/avatar'
import { Link, useRouter } from '@/i18n/navigation'
import { useAuthStore } from '@/lib/store'
import { cn } from '@/lib/utils'

export function UserMenu() {
  const t = useTranslations()
  const router = useRouter()
  const { user, logout } = useAuthStore()
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

  const onLogout = async () => {
    setOpen(false)
    await logout()
    router.replace('/login')
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'flex items-center gap-2 rounded-md border border-transparent pl-2 pr-1 py-1 transition-colors',
          'hover:border-[color:var(--border)] hover:bg-[color:var(--surface)]',
        )}
      >
        <Avatar
          src={user.avatar_url ?? undefined}
          name={user.display_name}
          email={user.email}
          size={32}
        />
        <span className="hidden sm:flex flex-col leading-tight text-left">
          <span className="text-sm font-medium text-[color:var(--fg)] max-w-[180px] truncate">
            {user.display_name}
          </span>
          <span className="text-xs text-[color:var(--muted)] max-w-[180px] truncate">
            {user.email}
          </span>
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-[color:var(--muted)] transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] shadow-lg"
        >
          <div className="px-4 py-3 border-b border-[color:var(--border)]">
            <p className="text-sm font-semibold text-[color:var(--fg)] truncate">
              {user.display_name}
            </p>
            <p className="text-xs text-[color:var(--muted)] truncate">
              {user.email}
            </p>
          </div>
          <nav className="py-1">
            <Link
              href="/profile"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-4 py-2 text-sm text-[color:var(--fg)] hover:bg-[color:var(--border)]/40"
            >
              <UserCircle className="h-4 w-4" />
              {t('profile.title')}
            </Link>
            <Link
              href="/settings"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-4 py-2 text-sm text-[color:var(--fg)] hover:bg-[color:var(--border)]/40"
            >
              <Settings className="h-4 w-4" />
              {t('nav.settings')}
            </Link>
          </nav>
          <div className="border-t border-[color:var(--border)] py-1">
            <button
              type="button"
              role="menuitem"
              onClick={onLogout}
              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-[color:var(--fg)] hover:bg-[color:var(--border)]/40"
            >
              <LogOut className="h-4 w-4" />
              {t('auth.logout')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
