'use client'

import { useTranslations } from 'next-intl'

import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Link } from '@/i18n/navigation'

const sections = [
  {
    href: '/admin/users',
    titleKey: 'admin.usersTitle',
    icon: '👥',
    descKey: 'admin.createUserHint',
  },
  {
    href: '/admin/departments',
    titleKey: 'admin.departments.title',
    icon: '🏢',
    descKey: 'admin.departments.subtitle',
  },
  {
    href: '/admin/system',
    titleKey: 'admin.system.title',
    icon: '⚙️',
    descKey: 'admin.system.subtitle',
  },
]

export default function AdminLanding() {
  const t = useTranslations()
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {sections.map((s) => (
        <Link key={s.href} href={s.href} className="group block">
          <Card className="h-full transition-colors group-hover:border-[color:var(--accent)]">
            <CardHeader className="flex flex-row items-center gap-3 border-b-0 pb-2">
              <span className="text-2xl leading-none">{s.icon}</span>
              <CardTitle>{t(s.titleKey)}</CardTitle>
            </CardHeader>
            <CardBody className="pt-1">
              <p className="text-sm text-[color:var(--muted)]">
                {t(s.descKey)}
              </p>
            </CardBody>
          </Card>
        </Link>
      ))}
    </div>
  )
}
