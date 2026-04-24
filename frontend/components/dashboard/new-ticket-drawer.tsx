'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input, Label, Select, Textarea } from '@/components/ui/input'
import { ApiError, ticketsApi } from '@/lib/api'
import { useUIStore } from '@/lib/ui-store'
import { useRouter } from '@/i18n/navigation'
import type { TicketPriority } from '@/lib/types'
import { cn } from '@/lib/utils'

const priorities: TicketPriority[] = ['low', 'medium', 'high', 'urgent']

// Slide-over modal for "New Ticket". Replaces the standalone /tickets/new
// page so users can compose a ticket without losing their current context
// (they could be reading an existing ticket, the dashboard, etc.).
export function NewTicketDrawer() {
  const t = useTranslations()
  const router = useRouter()
  const { newTicketOpen, closeNewTicket } = useUIStore()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<TicketPriority>('medium')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset state every time the drawer opens — never carry stale text across
  // separate ticket compositions.
  useEffect(() => {
    if (newTicketOpen) {
      setTitle('')
      setDescription('')
      setPriority('medium')
      setError(null)
    }
  }, [newTicketOpen])

  // ESC closes (matches Slack/Discord drawer behaviour).
  useEffect(() => {
    if (!newTicketOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeNewTicket()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newTicketOpen, closeNewTicket])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const tk = await ticketsApi.create({
        title: title.trim(),
        description: description.trim(),
        priority,
      })
      closeNewTicket()
      router.push(`/tickets/${tk.id}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/40 transition-opacity',
          newTicketOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={() => !submitting && closeNewTicket()}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t('ticket.newTicket')}
        data-aae-shell="true"
        className={cn(
          'fixed top-0 right-0 bottom-0 z-50 w-full sm:w-[480px] flex flex-col',
          'bg-[color:var(--surface)] border-l border-[color:var(--border)] shadow-2xl',
          'transition-transform duration-200 ease-out',
          newTicketOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <header className="shrink-0 flex items-center justify-between gap-3 px-5 py-3 border-b border-[color:var(--border)]">
          <div>
            <h2 className="text-base font-semibold text-[color:var(--fg)]">
              {t('ticket.newTicket')}
            </h2>
            <p className="mt-0.5 text-xs text-[color:var(--muted)]">
              {t('dashboard.createTicketHint')}
            </p>
          </div>
          <button
            type="button"
            onClick={closeNewTicket}
            disabled={submitting}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[color:var(--muted)] hover:text-[color:var(--fg)] hover:bg-[color:var(--border)]/40 disabled:opacity-40"
            aria-label={t('common.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <form onSubmit={onSubmit} className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="nt-title">{t('ticket.subject')}</Label>
              <Input
                id="nt-title"
                required
                minLength={3}
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={submitting}
                autoFocus
                placeholder={t('ticket.subjectPlaceholder')}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="nt-description">{t('ticket.description')}</Label>
              <Textarea
                id="nt-description"
                required
                minLength={10}
                rows={8}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={submitting}
                placeholder={t('ticket.descriptionPlaceholder')}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="nt-priority">{t('ticket.priorityLabel')}</Label>
              <Select
                id="nt-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TicketPriority)}
                disabled={submitting}
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
          </div>

          <footer className="shrink-0 flex items-center justify-between gap-2 px-5 py-3 border-t border-[color:var(--border)]">
            <p className="text-[11px] text-[color:var(--muted)]">
              {t('ticket.submitHint')}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={closeNewTicket}
                disabled={submitting}
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" loading={submitting}>
                {t('ticket.submit')}
              </Button>
            </div>
          </footer>
        </form>
      </aside>
    </>
  )
}
