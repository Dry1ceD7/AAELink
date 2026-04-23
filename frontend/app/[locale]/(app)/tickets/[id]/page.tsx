'use client'

import { useTranslations } from 'next-intl'
import { useParams } from 'next/navigation'
import { useRouter } from '@/i18n/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge, Card, CardBody, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, Textarea } from '@/components/ui/input'
import { mediaApi, ticketsApi } from '@/lib/api'
import { hasRole, useAuthStore } from '@/lib/store'
import type { Comment, MediaFile, Ticket, TicketStatus } from '@/lib/types'
import { fileIcon, formatBytes, priorityColor, statusColor } from '@/lib/utils'

const statuses: TicketStatus[] = [
  'open',
  'in_progress',
  'pending_employee',
  'resolved',
  'closed',
  'cancelled',
]

export default function TicketDetailPage() {
  const t = useTranslations()
  const params = useParams<{ id: string }>()
  const id = params?.id ?? ''
  const router = useRouter()
  const user = useAuthStore((s) => s.user)
  const isIT = hasRole(user, 'it_admin', 'it_employee')

  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [files, setFiles] = useState<MediaFile[]>([])
  const [loading, setLoading] = useState(true)
  const [newComment, setNewComment] = useState('')
  const [isInternal, setIsInternal] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [posting, setPosting] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const reload = useCallback(async () => {
    if (!id) return
    try {
      const [tk, cs, fs] = await Promise.all([
        ticketsApi.get(id),
        ticketsApi.comments(id).catch(() => [] as Comment[]),
        mediaApi
          .list(id)
          .then((r) => r.files)
          .catch(() => [] as MediaFile[]),
      ])
      setTicket(tk)
      setComments(cs)
      setFiles(fs)
    } catch {
      router.replace('/tickets')
    } finally {
      setLoading(false)
    }
  }, [id, router])

  useEffect(() => {
    reload()
  }, [reload])

  const onStatusChange = async (s: TicketStatus) => {
    if (!ticket) return
    const updated = await ticketsApi.updateStatus(ticket.id, s)
    setTicket(updated)
  }

  const onUpload = async (f: File) => {
    if (!ticket) return
    setUploading(true)
    try {
      await mediaApi.upload(ticket.id, f)
      await reload()
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const onPostComment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ticket || !newComment.trim()) return
    setPosting(true)
    try {
      await ticketsApi.addComment(ticket.id, newComment.trim(), isInternal)
      setNewComment('')
      setIsInternal(false)
      const cs = await ticketsApi.comments(ticket.id)
      setComments(cs)
    } finally {
      setPosting(false)
    }
  }

  const openAttachment = async (fid: string) => {
    const r = await mediaApi.presign(fid)
    window.open(r.url, '_blank', 'noopener,noreferrer')
  }

  if (loading) {
    return <p className="text-sm text-[color:var(--muted)]">{t('common.loading')}</p>
  }
  if (!ticket) return null

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs text-[color:var(--muted)]">
            {t('ticket.ticketNumber', { number: ticket.number })}
          </p>
          <h1 className="text-2xl font-bold text-[color:var(--fg)]">{ticket.title}</h1>
        </div>
        <Button variant="ghost" onClick={() => router.push('/tickets')}>
          ← {t('common.back')}
        </Button>
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Badge className={statusColor(ticket.status)}>
              {t(`ticket.status.${ticket.status}`)}
            </Badge>
            <Badge className={priorityColor(ticket.priority)}>
              {t(`ticket.priority.${ticket.priority}`)}
            </Badge>
          </div>
          {isIT && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[color:var(--muted)]">
                {t('ticket.updateStatus')}:
              </span>
              <Select
                value={ticket.status}
                onChange={(e) => onStatusChange(e.target.value as TicketStatus)}
                className="w-48 h-9"
              >
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {t(`ticket.status.${s}`)}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </CardHeader>
        <CardBody>
          <p className="whitespace-pre-wrap text-sm text-[color:var(--fg)]">
            {ticket.description}
          </p>
        </CardBody>
        <CardFooter className="text-xs text-[color:var(--muted)] flex-wrap gap-4">
          <span>
            {t('ticket.createdAt')}: {new Date(ticket.created_at).toLocaleString()}
          </span>
          <span>
            {t('ticket.updatedAt')}: {new Date(ticket.updated_at).toLocaleString()}
          </span>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>{t('ticket.attachments')}</CardTitle>
          <div>
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) onUpload(f)
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              loading={uploading}
              onClick={() => fileInput.current?.click()}
            >
              {t('ticket.uploadFile')}
            </Button>
          </div>
        </CardHeader>
        <CardBody>
          {files.length === 0 ? (
            <p className="text-sm text-[color:var(--muted)]">
              {t('ticket.noAttachments')}
            </p>
          ) : (
            <ul className="divide-y divide-[color:var(--border)]">
              {files.map((f) => (
                <li key={f.id} className="py-2 flex items-center gap-3">
                  <span className="text-xl" aria-hidden>
                    {fileIcon(f.kind)}
                  </span>
                  <button
                    type="button"
                    onClick={() => openAttachment(f.id)}
                    className="text-sm text-[color:var(--accent)] hover:underline truncate text-left flex-1"
                  >
                    {f.filename}
                  </button>
                  <span className="text-xs text-[color:var(--muted)] shrink-0">
                    {formatBytes(f.file_size)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('ticket.comments')}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          {comments.length === 0 ? (
            <p className="text-sm text-[color:var(--muted)]">{t('common.noData')}</p>
          ) : (
            <ul className="space-y-3">
              {comments.map((c) => (
                <li
                  key={c.id}
                  className="rounded-md border border-[color:var(--border)] p-3 bg-[color:var(--bg)]"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-[color:var(--muted)]">
                      {new Date(c.created_at).toLocaleString()}
                    </span>
                    {c.is_internal && (
                      <Badge className="bg-purple-500/15 text-purple-700 dark:text-purple-300">
                        {t('ticket.internalNote')}
                      </Badge>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-[color:var(--fg)]">
                    {c.content}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={onPostComment} className="space-y-2 pt-2 border-t border-[color:var(--border)]">
            <Textarea
              placeholder={t('ticket.writeComment')}
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              disabled={posting}
              rows={3}
              required
            />
            <div className="flex items-center justify-between flex-wrap gap-2">
              {isIT ? (
                <label className="flex items-center gap-2 text-xs text-[color:var(--muted)]">
                  <input
                    type="checkbox"
                    checked={isInternal}
                    onChange={(e) => setIsInternal(e.target.checked)}
                  />
                  {t('ticket.internalNote')}
                </label>
              ) : (
                <span />
              )}
              <Button type="submit" size="sm" loading={posting}>
                {t('ticket.sendComment')}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  )
}
