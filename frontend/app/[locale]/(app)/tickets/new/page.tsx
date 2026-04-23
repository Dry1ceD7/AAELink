'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label, Select, Textarea } from '@/components/ui/input'
import { ticketsApi } from '@/lib/api'
import type { TicketPriority } from '@/lib/types'

const priorities: TicketPriority[] = ['low', 'medium', 'high', 'urgent']

export default function NewTicketPage() {
  const t = useTranslations()
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<TicketPriority>('medium')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const tk = await ticketsApi.create({
        title: title.trim(),
        description: description.trim(),
        priority,
      })
      router.replace(`/tickets/${tk.id}`)
    } catch {
      setError(t('common.error'))
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-[color:var(--fg)]">{t('nav.newTicket')}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{t('dashboard.createTicket')}</CardTitle>
        </CardHeader>
        <CardBody>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="title">{t('ticket.subject')}</Label>
              <Input
                id="title"
                required
                minLength={3}
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description">{t('ticket.description')}</Label>
              <Textarea
                id="description"
                required
                minLength={10}
                rows={6}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="priority">{t('ticket.priorityLabel')}</Label>
              <Select
                id="priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TicketPriority)}
                disabled={loading}
              >
                {priorities.map((p) => (
                  <option key={p} value={p}>
                    {t(`ticket.priority.${p}`)}
                  </option>
                ))}
              </Select>
            </div>

            {error && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
                {error}
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button type="submit" loading={loading}>
                {t('ticket.submit')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => router.back()}
                disabled={loading}
              >
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  )
}
