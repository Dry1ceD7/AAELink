'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Badge, Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { ticketsApi } from '@/lib/api'
import type { Ticket, TicketStatus } from '@/lib/types'
import { priorityColor, statusColor } from '@/lib/utils'

const statuses: TicketStatus[] = [
  'open',
  'in_progress',
  'pending_employee',
  'resolved',
  'closed',
  'cancelled',
]

export default function TicketsListPage() {
  const t = useTranslations()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<string>('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    let mounted = true
    setLoading(true)
    ticketsApi
      .list(status ? { status } : {})
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
  }, [status])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return tickets
    return tickets.filter(
      (tk) =>
        tk.title.toLowerCase().includes(q) ||
        tk.description.toLowerCase().includes(q) ||
        String(tk.number).includes(q),
    )
  }, [tickets, search])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-[color:var(--fg)]">
          {t('ticket.tickets')}
        </h1>
        <Link href="/tickets/new">
          <Button>{t('nav.newTicket')}</Button>
        </Link>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Input
          placeholder={t('ticket.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-56"
          aria-label={t('ticket.filterByStatus')}
        >
          <option value="">{t('ticket.allStatuses')}</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {t(`ticket.status.${s}`)}
            </option>
          ))}
        </Select>
      </div>

      <Card>
        <CardBody className="p-0">
          {loading ? (
            <p className="px-5 py-4 text-sm text-[color:var(--muted)]">
              {t('common.loading')}
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-5 py-6 text-sm text-[color:var(--muted)] text-center">
              {t('ticket.noTickets')}
            </p>
          ) : (
            <ul className="divide-y divide-[color:var(--border)]">
              {filtered.map((tk) => (
                <li key={tk.id}>
                  <Link
                    href={`/tickets/${tk.id}`}
                    className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-[color:var(--border)]/40 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[color:var(--fg)] truncate">
                        #{tk.number} — {tk.title}
                      </p>
                      <p className="text-xs text-[color:var(--muted)] truncate">
                        {tk.description}
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
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
