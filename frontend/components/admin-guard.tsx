'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { hasRole, useAuthStore } from '@/lib/store'

interface Props {
  children: React.ReactNode
  roles?: string[]
}

export function AdminGuard({ children, roles = ['it_admin'] }: Props) {
  const t = useTranslations()
  const router = useRouter()
  const { user, isHydrated } = useAuthStore()

  useEffect(() => {
    if (!isHydrated) return
    if (!user) {
      router.replace('/login')
      return
    }
    if (!hasRole(user, ...roles)) {
      router.replace('/dashboard')
    }
  }, [isHydrated, user, roles, router])

  if (!isHydrated) {
    return (
      <div className="p-6 text-sm text-[color:var(--muted)]">
        {t('common.loading')}
      </div>
    )
  }
  if (!user || !hasRole(user, ...roles)) {
    return (
      <div className="p-6 text-sm text-[color:var(--muted)]">
        {t('error.INSUFFICIENT_PERMISSIONS')}
      </div>
    )
  }
  return <>{children}</>
}
