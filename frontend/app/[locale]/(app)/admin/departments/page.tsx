'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { adminApi, ApiError } from '@/lib/api'
import type { Department } from '@/lib/types'

interface NameForm {
  en: string
  th: string
  de: string
}

export default function AdminDepartmentsPage() {
  const t = useTranslations()
  const [items, setItems] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [topMsg, setTopMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(
    null,
  )

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Department | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function refresh() {
    setLoading(true)
    setLoadError(null)
    try {
      const r = await adminApi.listDepartments()
      setItems(r.departments)
    } catch (err) {
      setLoadError(
        err instanceof ApiError
          ? err.message
          : t('admin.departments.loadFailed'),
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const sorted = useMemo(
    () => [...items].sort((a, b) => a.slug.localeCompare(b.slug)),
    [items],
  )

  function flash(kind: 'ok' | 'err', text: string) {
    setTopMsg({ kind, text })
    setTimeout(() => setTopMsg(null), 3000)
  }

  async function onConfirmDelete() {
    if (!deleteTarget) return
    setBusyId(deleteTarget.id)
    try {
      await adminApi.deleteDepartment(deleteTarget.id)
      setItems((prev) => prev.filter((x) => x.id !== deleteTarget.id))
      flash('ok', t('admin.departments.deleted'))
      setDeleteTarget(null)
    } catch (err) {
      flash(
        'err',
        err instanceof ApiError
          ? err.message
          : t('admin.departments.deleteFailed'),
      )
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-end justify-between gap-4">
        <h2 className="text-xl font-semibold text-[color:var(--fg)]">
          {t('admin.departments.title')}
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-[color:var(--muted)]">
            {t('admin.departments.totalDepartments', { count: items.length })}
          </span>
          <Button onClick={() => setCreateOpen(true)}>
            {t('admin.departments.create')}
          </Button>
        </div>
      </div>

      {topMsg && (
        <div
          className={
            topMsg.kind === 'ok'
              ? 'rounded-md bg-green-100 px-4 py-2 text-sm text-green-800 dark:bg-green-900/40 dark:text-green-200'
              : 'rounded-md bg-red-100 px-4 py-2 text-sm text-red-800 dark:bg-red-900/40 dark:text-red-200'
          }
        >
          {topMsg.text}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.departments.title')}</CardTitle>
          <p className="mt-1 text-xs text-[color:var(--muted)]">
            {t('admin.departments.subtitle')}
          </p>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <p className="px-5 py-4 text-sm text-[color:var(--muted)]">
              {t('common.loading')}
            </p>
          ) : loadError ? (
            <p className="px-5 py-4 text-sm text-red-600">{loadError}</p>
          ) : sorted.length === 0 ? (
            <p className="px-5 py-4 text-sm text-[color:var(--muted)]">
              {t('admin.departments.noDepartments')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[color:var(--bg)] text-left text-xs uppercase tracking-wide text-[color:var(--muted)]">
                  <tr>
                    <th className="px-4 py-2">
                      {t('admin.departments.slug')}
                    </th>
                    <th className="px-4 py-2">
                      {t('admin.departments.nameEn')}
                    </th>
                    <th className="px-4 py-2">
                      {t('admin.departments.nameTh')}
                    </th>
                    <th className="px-4 py-2">
                      {t('admin.departments.nameDe')}
                    </th>
                    <th className="px-4 py-2">
                      {t('admin.departments.isITDept')}
                    </th>
                    <th className="px-4 py-2 text-right">
                      {t('admin.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((d) => (
                    <tr
                      key={d.id}
                      className="border-t border-[color:var(--border)]"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-[color:var(--fg)]">
                        {d.slug}
                      </td>
                      <td className="px-4 py-3 text-[color:var(--fg)]">
                        {d.name.en || '—'}
                      </td>
                      <td className="px-4 py-3 text-[color:var(--fg)]">
                        {d.name.th || '—'}
                      </td>
                      <td className="px-4 py-3 text-[color:var(--fg)]">
                        {d.name.de || '—'}
                      </td>
                      <td className="px-4 py-3">
                        {d.is_it_dept ? '✓' : ''}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEditTarget(d)}
                          >
                            {t('admin.edit')}
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={busyId === d.id}
                            onClick={() => setDeleteTarget(d)}
                          >
                            {t('admin.delete')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <DepartmentFormModal
        open={createOpen}
        title={t('admin.departments.createTitle')}
        initial={{ slug: '', is_it_dept: false, name: { en: '', th: '', de: '' } }}
        onClose={() => setCreateOpen(false)}
        onSubmit={async (slug, name, isIT) => {
          const created = await adminApi.createDepartment({
            slug,
            name,
            is_it_dept: isIT,
          })
          setItems((prev) => [...prev, created])
          flash('ok', t('admin.departments.created'))
          setCreateOpen(false)
        }}
        onError={(m) => flash('err', m)}
        defaultErrorKey="admin.departments.createFailed"
      />

      <DepartmentFormModal
        open={!!editTarget}
        title={t('admin.departments.edit')}
        initial={
          editTarget
            ? {
              slug: editTarget.slug,
              is_it_dept: editTarget.is_it_dept,
              name: {
                en: editTarget.name.en ?? '',
                th: editTarget.name.th ?? '',
                de: editTarget.name.de ?? '',
              },
            }
            : { slug: '', is_it_dept: false, name: { en: '', th: '', de: '' } }
        }
        onClose={() => setEditTarget(null)}
        onSubmit={async (slug, name, isIT) => {
          if (!editTarget) return
          const updated = await adminApi.updateDepartment(editTarget.id, {
            slug,
            name,
            is_it_dept: isIT,
          })
          setItems((prev) =>
            prev.map((x) => (x.id === updated.id ? updated : x)),
          )
          flash('ok', t('admin.departments.updated'))
          setEditTarget(null)
        }}
        onError={(m) => flash('err', m)}
        defaultErrorKey="admin.departments.updateFailed"
      />

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={t('admin.delete')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              {t('admin.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={busyId === deleteTarget?.id}
              onClick={onConfirmDelete}
            >
              {t('admin.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-[color:var(--fg)]">
          {deleteTarget &&
            t('admin.departments.confirmDelete', {
              name:
                deleteTarget.name.en ||
                deleteTarget.name.th ||
                deleteTarget.name.de ||
                deleteTarget.slug,
            })}
        </p>
      </Modal>
    </div>
  )
}

function DepartmentFormModal({
  open,
  title,
  initial,
  onClose,
  onSubmit,
  onError,
  defaultErrorKey,
}: {
  open: boolean
  title: string
  initial: { slug: string; is_it_dept: boolean; name: NameForm }
  onClose: () => void
  onSubmit: (
    slug: string,
    name: Record<string, string>,
    isIT: boolean,
  ) => Promise<void>
  onError: (msg: string) => void
  defaultErrorKey: string
}) {
  const t = useTranslations()
  const [slug, setSlug] = useState(initial.slug)
  const [isIT, setIsIT] = useState(initial.is_it_dept)
  const [name, setName] = useState<NameForm>(initial.name)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setSlug(initial.slug)
      setIsIT(initial.is_it_dept)
      setName(initial.name)
    }
  }, [open, initial])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const cleanName: Record<string, string> = {}
      if (name.en.trim()) cleanName.en = name.en.trim()
      if (name.th.trim()) cleanName.th = name.th.trim()
      if (name.de.trim()) cleanName.de = name.de.trim()
      await onSubmit(slug.trim().toLowerCase(), cleanName, isIT)
    } catch (err) {
      onError(err instanceof ApiError ? err.message : t(defaultErrorKey))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('admin.cancel')}
          </Button>
          <Button onClick={submit} loading={busy}>
            {t('admin.save')}
          </Button>
        </>
      }
    >
      <form className="grid gap-3" onSubmit={submit}>
        <div className="space-y-1">
          <Label>{t('admin.departments.slug')}</Label>
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
            minLength={2}
            placeholder="it-support"
          />
          <p className="text-xs text-[color:var(--muted)]">
            {t('admin.departments.slugHint')}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label>{t('admin.departments.nameEn')}</Label>
            <Input
              value={name.en}
              onChange={(e) => setName((n) => ({ ...n, en: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label>{t('admin.departments.nameTh')}</Label>
            <Input
              value={name.th}
              onChange={(e) => setName((n) => ({ ...n, th: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label>{t('admin.departments.nameDe')}</Label>
            <Input
              value={name.de}
              onChange={(e) => setName((n) => ({ ...n, de: e.target.value }))}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-[color:var(--fg)]">
          <input
            type="checkbox"
            checked={isIT}
            onChange={(e) => setIsIT(e.target.checked)}
          />
          {t('admin.departments.isITDept')}
        </label>
      </form>
    </Modal>
  )
}
