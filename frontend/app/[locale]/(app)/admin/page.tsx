'use client'

import type { ComponentType, SVGProps } from 'react'
import { useTranslations } from 'next-intl'
import { Building2, Settings, ShieldCheck, Users } from 'lucide-react'

import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Link } from '@/i18n/navigation'

type IconType = ComponentType<SVGProps<SVGSVGElement>>

interface Section {
  href: string
  titleKey: string
  Icon: IconType
  descKey: string
}

const sections: Section[] = [
  {
    href: '/admin/users',
    titleKey: 'admin.usersTitle',
    Icon: Users,
    descKey: 'admin.createUserHint',
  },
  {
    href: '/admin/roles',
    titleKey: 'admin.rolesTitle',
    Icon: ShieldCheck,
    descKey: 'admin.rolesSubtitle',
  },
  {
    href: '/admin/departments',
    titleKey: 'admin.departments.title',
    Icon: Building2,
    descKey: 'admin.departments.subtitle',
  },
  {
    href: '/admin/system',
    titleKey: 'admin.system.title',
    Icon: Settings,
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
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-[color:var(--accent)]/10 text-[color:var(--accent)]">
                <s.Icon className="h-5 w-5" />
              </span>
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
