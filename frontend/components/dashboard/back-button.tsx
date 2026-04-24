'use client'

import { useTranslations } from 'next-intl'
import { ArrowLeft } from 'lucide-react'

import { useRouter, usePathname } from '@/i18n/navigation'
import { cn } from '@/lib/utils'

// Persistent global Back control. Shown on every page; on root entry
// surfaces (dashboard, top-level tickets list) the click falls back to a
// safe default destination so the user never sees a "no history" jump.
export function BackButton() {
  const t = useTranslations()
  const router = useRouter()
  const pathname = usePathname() ?? '/'
  const isAtRoot = pathname === '/dashboard'

  const onBack = () => {
    if (typeof window === 'undefined') {
      router.push('/dashboard')
      return
    }
    // history.length is 1 on a fresh tab. We never want to drop the user
    // off the application: fall back to /dashboard, or /tickets if we
    // are already on the dashboard.
    if (window.history.length > 1 && !isAtRoot) {
      router.back()
      return
    }
    router.push(isAtRoot ? '/tickets' : '/dashboard')
  }

  return (
    <button
      type="button"
      onClick={onBack}
      aria-label={t('common.back')}
      title={t('common.back')}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-md',
        'text-[color:var(--muted)] hover:text-[color:var(--fg)]',
        'hover:bg-[color:var(--border)]/40 transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]',
      )}
    >
      <ArrowLeft className="h-4 w-4" />
    </button>
  )
}
