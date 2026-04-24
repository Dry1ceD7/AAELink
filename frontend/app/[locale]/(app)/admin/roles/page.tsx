'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Lock, Plus, ShieldCheck, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input, Label, Textarea } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { adminApi, ApiError } from '@/lib/api'
import type { Permission, RoleDefinition } from '@/lib/types'

interface FormState {
  name: string
  display_en: string
  display_th: string
  display_de: string
  description: string
  permissionIds: Set<string>
}

const EMPTY_FORM: FormState = {
  name: '',
  display_en: '',
  display_th: '',
  display_de: '',
  description: '',
  permissionIds: new Set(),
}

export default function AdminRolesPage() {
  const t = useTranslations()
  const [roles, setRoles] = useState<RoleDefinition[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(
    null,
  )

  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [creating, setCreating] = useState(false)
  const [pendingCreate, setPendingCreate] = useState(false)

  const [editTarget, setEditTarget] = useState<RoleDefinition | null>(null)
  const [editPerms, setEditPerms] = useState<Set<string>>(new Set())
  const [editBusy, setEditBusy] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<RoleDefinition | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const [rs, ps] = await Promise.all([
        adminApi.listRoles(),
        adminApi.listPermissions(),
      ])
      setRoles(rs.roles)
      setPermissions(ps.permissions)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.roles.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  function showFlash(kind: 'ok' | 'err', text: string) {
    setFlash({ kind, text })
    setTimeout(() => setFlash(null), 3500)
  }

  function togglePerm(set: Set<string>, id: string) {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  function onSubmitCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || !form.display_en.trim()) {
      showFlash('err', t('admin.roles.requiredFields'))
      return
    }
    setPendingCreate(true)
  }

  async function commitCreate() {
    setCreating(true)
    try {
      await adminApi.createRole({
        name: form.name.trim().toLowerCase(),
        display_name: {
          en: form.display_en.trim(),
          th: form.display_th.trim() || form.display_en.trim(),
          de: form.display_de.trim() || form.display_en.trim(),
        },
        description: form.description.trim(),
        permission_ids: Array.from(form.permissionIds),
      })
      setForm(EMPTY_FORM)
      setPendingCreate(false)
      showFlash('ok', t('admin.roles.created'))
      await refresh()
    } catch (err) {
      showFlash(
        'err',
        err instanceof ApiError ? err.message : t('admin.roles.createFailed'),
      )
    } finally {
      setCreating(false)
    }
  }

  function openEdit(role: RoleDefinition) {
    setEditTarget(role)
    setEditPerms(new Set(role.permissions.map((p) => p.id)))
  }

  async function commitEdit() {
    if (!editTarget) return
    setEditBusy(true)
    try {
      await adminApi.updateRole(editTarget.id, {
        permission_ids: Array.from(editPerms),
      })
      setEditTarget(null)
      showFlash('ok', t('admin.roles.updated'))
      await refresh()
    } catch (err) {
      showFlash(
        'err',
        err instanceof ApiError ? err.message : t('admin.roles.updateFailed'),
      )
    } finally {
      setEditBusy(false)
    }
  }

  async function commitDelete() {
    if (!deleteTarget) return
    setDeleteBusy(true)
    try {
      await adminApi.deleteRole(deleteTarget.id)
      setDeleteTarget(null)
      showFlash('ok', t('admin.roles.deleted'))
      await refresh()
    } catch (err) {
      showFlash(
        'err',
        err instanceof ApiError ? err.message : t('admin.roles.deleteFailed'),
      )
    } finally {
      setDeleteBusy(false)
    }
  }

  // Group permissions by resource so the Slack-style picker stays scannable.
  const grouped = useMemo(() => {
    const map = new Map<string, Permission[]>()
    for (const p of permissions) {
      const arr = map.get(p.resource) ?? []
      arr.push(p)
      map.set(p.resource, arr)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [permissions])

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-[color:var(--fg)]">
            {t('admin.rolesTitle')}
          </h2>
          <p className="text-sm text-[color:var(--muted)]">
            {t('admin.rolesSubtitle')}
          </p>
        </div>
        <span className="text-sm text-[color:var(--muted)]">
          {t('admin.roles.total', { count: roles.length })}
        </span>
      </div>

      {flash && (
        <div
          className={
            flash.kind === 'ok'
              ? 'rounded-md bg-green-100 px-4 py-2 text-sm text-green-800 dark:bg-green-900/40 dark:text-green-200'
              : 'rounded-md bg-red-100 px-4 py-2 text-sm text-red-800 dark:bg-red-900/40 dark:text-red-200'
          }
        >
          {flash.text}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.roles.createTitle')}</CardTitle>
          <p className="mt-1 text-xs text-[color:var(--muted)]">
            {t('admin.roles.createHint')}
          </p>
        </CardHeader>
        <form onSubmit={onSubmitCreate}>
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="role-name">{t('admin.roles.name')}</Label>
              <Input
                id="role-name"
                placeholder="ops_manager"
                required
                pattern="[a-z0-9_]{2,64}"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    name: e.target.value.toLowerCase().replace(/\s+/g, '_'),
                  }))
                }
              />
              <p className="text-xs text-[color:var(--muted)]">
                {t('admin.roles.nameHint')}
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="role-en">{t('admin.roles.displayEn')}</Label>
              <Input
                id="role-en"
                required
                value={form.display_en}
                onChange={(e) =>
                  setForm((f) => ({ ...f, display_en: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="role-th">{t('admin.roles.displayTh')}</Label>
              <Input
                id="role-th"
                value={form.display_th}
                onChange={(e) =>
                  setForm((f) => ({ ...f, display_th: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="role-de">{t('admin.roles.displayDe')}</Label>
              <Input
                id="role-de"
                value={form.display_de}
                onChange={(e) =>
                  setForm((f) => ({ ...f, display_de: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="role-desc">{t('admin.roles.description')}</Label>
              <Textarea
                id="role-desc"
                rows={2}
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>{t('admin.roles.permissions')}</Label>
              <PermissionPicker
                grouped={grouped}
                selected={form.permissionIds}
                onToggle={(id) =>
                  setForm((f) => ({
                    ...f,
                    permissionIds: togglePerm(f.permissionIds, id),
                  }))
                }
              />
            </div>
          </CardBody>
          <CardFooter className="justify-end">
            <Button type="submit" loading={creating}>
              <Plus className="h-4 w-4" />
              {t('admin.roles.create')}
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.roles.existingTitle')}</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <p className="px-5 py-4 text-sm text-[color:var(--muted)]">
              {t('common.loading')}
            </p>
          ) : error ? (
            <p className="px-5 py-4 text-sm text-red-600">{error}</p>
          ) : roles.length === 0 ? (
            <p className="px-5 py-4 text-sm text-[color:var(--muted)]">
              {t('admin.roles.empty')}
            </p>
          ) : (
            <ul className="divide-y divide-[color:var(--border)]">
              {roles.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-start justify-between gap-3 px-5 py-3"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-semibold text-[color:var(--fg)]">
                      <ShieldCheck className="h-4 w-4 text-[color:var(--accent)]" />
                      {r.display_name.en || r.name}
                      {r.is_system && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--accent)]/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[color:var(--accent)]">
                          <Lock className="h-3 w-3" /> {t('admin.roles.system')}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-[color:var(--muted)]">
                      <code className="rounded bg-[color:var(--bg)] px-1 py-0.5">
                        {r.name}
                      </code>
                      {r.description ? ` — ${r.description}` : ''}
                    </p>
                    <p className="mt-1 text-xs text-[color:var(--muted)]">
                      {t('admin.roles.permissionCount', {
                        count: r.permissions.length,
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEdit(r)}
                    >
                      {t('admin.edit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={r.is_system}
                      onClick={() => setDeleteTarget(r)}
                      title={r.is_system ? t('admin.roles.systemProtected') : ''}
                    >
                      <Trash2 className="h-4 w-4" />
                      {t('admin.delete')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Modal
        open={pendingCreate}
        onClose={() => !creating && setPendingCreate(false)}
        title={t('admin.roles.confirmCreateTitle')}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setPendingCreate(false)}
              disabled={creating}
            >
              {t('admin.cancel')}
            </Button>
            <Button onClick={commitCreate} loading={creating}>
              {t('admin.roles.confirmCreate')}
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-[color:var(--fg)]">
          <p>
            {t('admin.roles.confirmCreateBody', {
              role: form.display_en || form.name,
              count: form.permissionIds.size,
            })}
          </p>
          <p className="text-xs text-[color:var(--muted)]">
            {t('admin.roles.confirmCreateHint')}
          </p>
        </div>
      </Modal>

      <Modal
        open={!!editTarget}
        onClose={() => !editBusy && setEditTarget(null)}
        title={t('admin.roles.editTitle')}
        size="lg"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setEditTarget(null)}
              disabled={editBusy}
            >
              {t('admin.cancel')}
            </Button>
            <Button onClick={commitEdit} loading={editBusy}>
              {t('admin.save')}
            </Button>
          </>
        }
      >
        {editTarget && (
          <div className="space-y-3">
            <p className="text-sm text-[color:var(--fg)]">
              <code className="rounded bg-[color:var(--bg)] px-1 py-0.5">
                {editTarget.name}
              </code>{' '}
              — {editTarget.display_name.en}
            </p>
            <PermissionPicker
              grouped={grouped}
              selected={editPerms}
              onToggle={(id) => setEditPerms((s) => togglePerm(s, id))}
            />
          </div>
        )}
      </Modal>

      <Modal
        open={!!deleteTarget}
        onClose={() => !deleteBusy && setDeleteTarget(null)}
        title={t('admin.roles.confirmDeleteTitle')}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
              disabled={deleteBusy}
            >
              {t('admin.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={commitDelete}
              loading={deleteBusy}
            >
              {t('admin.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-[color:var(--fg)]">
          {deleteTarget &&
            t('admin.roles.confirmDeleteBody', {
              role: deleteTarget.display_name.en || deleteTarget.name,
            })}
        </p>
      </Modal>
    </div>
  )
}

function PermissionPicker({
  grouped,
  selected,
  onToggle,
}: {
  grouped: [string, Permission[]][]
  selected: Set<string>
  onToggle: (id: string) => void
}) {
  return (
    <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--bg)]/60 p-2 max-h-72 overflow-y-auto space-y-3">
      {grouped.length === 0 && (
        <p className="px-2 py-1 text-xs text-[color:var(--muted)]">—</p>
      )}
      {grouped.map(([resource, perms]) => (
        <div key={resource}>
          <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--muted)]">
            {resource}
          </p>
          <div className="mt-1 grid gap-1 sm:grid-cols-2">
            {perms.map((p) => {
              const checked = selected.has(p.id)
              return (
                <label
                  key={p.id}
                  className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 hover:bg-[color:var(--surface)]"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-[color:var(--accent)]"
                    checked={checked}
                    onChange={() => onToggle(p.id)}
                  />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-[color:var(--fg)]">
                      {p.action}
                    </span>
                    {p.description && (
                      <span className="block text-[11px] text-[color:var(--muted)]">
                        {p.description}
                      </span>
                    )}
                  </span>
                </label>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
