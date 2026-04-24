'use client'

import type { ComponentType, SVGProps } from 'react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { Building2, Settings, ShieldCheck, Users } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { ticketsApi } from '@/lib/api'
import { hasRole, useAuthStore } from '@/lib/store'
import type { Ticket } from '@/lib/types'
import { cn, priorityColor, statusColor } from '@/lib/utils'

export default function DashboardPage() {
  const t = useTranslations()
  const user = useAuthStore((s) => s.user)
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    ticketsApi
      .list({ limit: 5 })
      .then((r) => {
        if (mounted) setTickets(r)
      })
      .catch(() => {
        if (mounted) setTickets([])
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [])

  const open = tickets.filter((tk) => tk.status === 'open').length
  const inProgress = tickets.filter((tk) => tk.status === 'in_progress').length
  const resolved = tickets.filter((tk) => tk.status === 'resolved').length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[color:var(--fg)]">
            {t('dashboard.title')}
          </h1>
          <p className="text-sm text-[color:var(--muted)]">
            {t('dashboard.welcome', { name: user?.display_name ?? '' })}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label={t('dashboard.openTickets')} value={open} tint="blue" />
        <StatCard label={t('dashboard.inProgress')} value={inProgress} tint="amber" />
        <StatCard label={t('dashboard.resolved')} value={resolved} tint="green" />
      </div>

      {hasRole(user, 'it_admin') && (
        <Card>
          <CardHeader>
            <CardTitle>{t('admin.title')}</CardTitle>
          </CardHeader>
          <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <AdminShortcut
              href="/admin"
              Icon={ShieldCheck}
              label={t('admin.title')}
              hint={t('admin.subtitle')}
            />
            <AdminShortcut
              href="/admin/users"
              Icon={Users}
              label={t('admin.usersTitle')}
              hint={t('admin.createUserHint')}
            />
            <AdminShortcut
              href="/admin/departments"
              Icon={Building2}
              label={t('admin.departmentsTitle')}
              hint={t('admin.departments.subtitle')}
            />
            <AdminShortcut
              href="/admin/system"
              Icon={Settings}
              label={t('admin.systemTitle')}
              hint={t('admin.system.subtitle')}
            />
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>{t('dashboard.recentTickets')}</CardTitle>
          <Link
            className="text-sm text-[color:var(--accent)] hover:underline"
            href="/tickets"
          >
            {t('dashboard.viewAll')}
          </Link>
        </CardHeader>
        <CardBody>
          {loading ? (
            <p className="text-sm text-[color:var(--muted)]">{t('common.loading')}</p>
          ) : tickets.length === 0 ? (
            <p className="text-sm text-[color:var(--muted)]">{t('ticket.noTickets')}</p>
          ) : (
            <ul className="divide-y divide-[color:var(--border)]">
              {tickets.slice(0, 5).map((tk) => (
                <li key={tk.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/tickets/${tk.id}`}
                      className="text-sm font-medium text-[color:var(--fg)] hover:underline truncate block"
                    >
                      #{tk.number} — {tk.title}
                    </Link>
                    <p className="text-xs text-[color:var(--muted)]">
                      {new Date(tk.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge className={priorityColor(tk.priority)}>
                      {t(`ticket.priority.${tk.priority}`)}
                    </Badge>
                    <Badge className={statusColor(tk.status)}>
                      {t(`ticket.status.${tk.status}`)}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function AdminShortcut({
  href,
  Icon,
  label,
  hint,
}: {
  href: string
  Icon: ComponentType<SVGProps<SVGSVGElement>>
  label: string
  hint: string
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-3 rounded-md border border-[color:var(--border)] p-3 transition-colors hover:border-[color:var(--accent)] hover:bg-[color:var(--accent)]/5"
    >
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-[color:var(--accent)]/10 text-[color:var(--accent)]">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-[color:var(--fg)] group-hover:text-[color:var(--accent)]">
          {label}
        </p>
        <p className="mt-0.5 text-xs text-[color:var(--muted)] line-clamp-2">
          {hint}
        </p>
      </div>
    </Link>
  )
}

function StatCard({
  label,
  value,
  tint,
}: {
  label: string
  value: number
  tint: 'blue' | 'amber' | 'green'
}) {
  const ring =
    tint === 'blue'
      ? 'ring-blue-500/30'
      : tint === 'amber'
        ? 'ring-amber-500/30'
        : 'ring-green-500/30'
  return (
    <Card className={cn('ring-1', ring)}>
      <CardBody>
        <p className="text-xs uppercase tracking-wide text-[color:var(--muted)]">
          {label}
        </p>
        <p className="mt-1 text-3xl font-bold text-[color:var(--fg)]">{value}</p>
      </CardBody>
    </Card>
  )
}
