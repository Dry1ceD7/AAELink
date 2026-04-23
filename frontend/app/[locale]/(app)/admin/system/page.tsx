'use client'

import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'

interface Link {
  label: string
  href: string
  desc: string
}

const links: Link[] = [
  {
    label: 'Traefik Dashboard',
    href: 'http://localhost:8081',
    desc: 'Edge router & service routes',
  },
  {
    label: 'Grafana',
    href: 'http://localhost:3001',
    desc: 'Metrics dashboards (Prometheus + Loki)',
  },
  {
    label: 'Prometheus',
    href: 'http://localhost:9090',
    desc: 'Metrics scrape & query',
  },
  {
    label: 'Loki',
    href: 'http://localhost:3100',
    desc: 'Log aggregation',
  },
  {
    label: 'MinIO Console',
    href: 'http://localhost:9001',
    desc: 'Object storage admin',
  },
  {
    label: 'Mailhog',
    href: 'http://localhost:8025',
    desc: 'Local SMTP capture',
  },
  {
    label: 'Auth /healthz',
    href: '/api/v1/auth/healthz',
    desc: 'Auth service health',
  },
  {
    label: 'Tickets /healthz',
    href: '/api/v1/tickets/healthz',
    desc: 'Tickets service health',
  },
  {
    label: 'Media /healthz',
    href: '/api/media/healthz',
    desc: 'Media service health',
  },
]

export default function AdminSystemPage() {
  const t = useTranslations()
  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h2 className="text-xl font-semibold text-[color:var(--fg)]">
          {t('admin.system.title')}
        </h2>
        <p className="mt-1 text-sm text-[color:var(--muted)]">
          {t('admin.system.subtitle')}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((l) => (
          <Card key={l.href}>
            <CardHeader>
              <CardTitle>{l.label}</CardTitle>
            </CardHeader>
            <CardBody className="flex h-full flex-col gap-3">
              <p className="text-sm text-[color:var(--muted)]">{l.desc}</p>
              <p className="break-all font-mono text-xs text-[color:var(--muted)]">
                {l.href}
              </p>
              <div className="mt-auto">
                <a href={l.href} target="_blank" rel="noreferrer">
                  <Button variant="outline" size="sm">
                    {t('admin.system.openLink')}
                  </Button>
                </a>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  )
}
