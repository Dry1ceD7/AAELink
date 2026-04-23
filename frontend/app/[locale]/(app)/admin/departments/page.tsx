'use client'

import { useTranslations } from 'next-intl'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'

export default function AdminDepartmentsPage() {
  const t = useTranslations()
  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-[color:var(--fg)]">
        {t('admin.departmentsTitle')}
      </h1>

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.departmentsTitle')}</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-[color:var(--muted)]">{t('admin.comingSoon')}</p>
        </CardBody>
      </Card>
    </div>
  )
}
