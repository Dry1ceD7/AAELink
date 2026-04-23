'use client'

import { useTranslations } from 'next-intl'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/lib/store'

export default function AdminUsersPage() {
  const t = useTranslations()
  const user = useAuthStore((s) => s.user)

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-[color:var(--fg)]">
        {t('admin.usersTitle')}
      </h1>

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.usersTitle')}</CardTitle>
        </CardHeader>
        <CardBody>
          {user && (
            <div className="rounded-md border border-[color:var(--border)] p-3 mb-4 bg-[color:var(--bg)]">
              <p className="text-sm text-[color:var(--fg)]">
                <strong>{t('admin.name')}:</strong> {user.display_name}
              </p>
              <p className="text-sm text-[color:var(--muted)]">
                <strong>{t('admin.email')}:</strong> {user.email}
              </p>
              <p className="text-sm text-[color:var(--muted)]">
                <strong>{t('admin.role')}:</strong>{' '}
                {(user.roles ?? []).map((r) => t(`role.${r}`)).join(', ') || '—'}
              </p>
            </div>
          )}
          <p className="text-sm text-[color:var(--muted)]">{t('admin.comingSoon')}</p>
        </CardBody>
      </Card>
    </div>
  )
}
