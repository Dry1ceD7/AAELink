'use client'

import { useTranslations } from 'next-intl'
import { Bell, Globe, Monitor, ShieldCheck, UserCog } from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'

import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { ThemeToggle } from '@/components/theme-toggle'
import { Link } from '@/i18n/navigation'
import { hasRole, useAuthStore } from '@/lib/store'

type IconType = ComponentType<SVGProps<SVGSVGElement>>

interface Row {
  Icon: IconType
  titleKey: string
  descKey: string
  control?: React.ReactNode
  href?: string
}

export default function SettingsPage() {
  const t = useTranslations()
  const user = useAuthStore((s) => s.user)

  const rows: Row[] = [
    {
      Icon: Globe,
      titleKey: 'settings.languageTitle',
      descKey: 'settings.languageDesc',
      control: <LocaleSwitcher />,
    },
    {
      Icon: Monitor,
      titleKey: 'settings.themeTitle',
      descKey: 'settings.themeDesc',
      control: <ThemeToggle />,
    },
    {
      Icon: UserCog,
      titleKey: 'settings.profileTitle',
      descKey: 'settings.profileDesc',
      href: '/profile',
    },
    {
      Icon: Bell,
      titleKey: 'settings.notificationsTitle',
      descKey: 'settings.notificationsDesc',
    },
  ]
  if (hasRole(user, 'it_admin')) {
    rows.push({
      Icon: ShieldCheck,
      titleKey: 'settings.adminTitle',
      descKey: 'settings.adminDesc',
      href: '/admin',
    })
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[color:var(--fg)]">
          {t('nav.settings')}
        </h1>
        <p className="mt-1 text-sm text-[color:var(--muted)]">
          {t('settings.subtitle')}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.preferencesTitle')}</CardTitle>
        </CardHeader>
        <CardBody className="divide-y divide-[color:var(--border)] p-0">
          {rows.map((r, idx) => {
            const body = (
              <div className="flex items-center gap-4 px-5 py-4">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[color:var(--accent)]/10 text-[color:var(--accent)]">
                  <r.Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[color:var(--fg)]">
                    {t(r.titleKey)}
                  </p>
                  <p className="text-xs text-[color:var(--muted)]">
                    {t(r.descKey)}
                  </p>
                </div>
                {r.control && <div className="shrink-0">{r.control}</div>}
                {r.href && (
                  <span className="shrink-0 text-xs text-[color:var(--muted)]">
                    {t('common.next')}
                  </span>
                )}
              </div>
            )
            return r.href ? (
              <Link
                key={idx}
                href={r.href}
                className="block transition-colors hover:bg-[color:var(--border)]/30"
              >
                {body}
              </Link>
            ) : (
              <div key={idx}>{body}</div>
            )
          })}
        </CardBody>
      </Card>

      <p className="text-center text-xs text-[color:var(--muted)]">
        {t('settings.comingSoon')}
      </p>
    </div>
  )
}
