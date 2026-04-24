'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input, Label, Select } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { adminApi, ApiError } from '@/lib/api'
import { useAuthStore } from '@/lib/store'
import type { AdminUser, Department, Role, RoleDefinition } from '@/lib/types'

const FALLBACK_ROLES: Role[] = ['it_admin', 'it_employee', 'employee']
const LOCALE_OPTIONS = ['en', 'th', 'de'] as const

export default function AdminUsersPage() {
  const t = useTranslations()
  const currentUser = useAuthStore((s) => s.user)

  const [users, setUsers] = useState<AdminUser[]>([])
  const [depts, setDepts] = useState<Department[]>([])
  const [roleDefs, setRoleDefs] = useState<RoleDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<Record<string, string | null>>({})

  const [editTarget, setEditTarget] = useState<AdminUser | null>(null)
  const [pwTarget, setPwTarget] = useState<AdminUser | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null)

  const [form, setForm] = useState({
    email: '',
    display_name: '',
    password: '',
    password_confirm: '',
    locale: 'en',
    role: 'employee' as Role,
    department_id: '',
  })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createSuccess, setCreateSuccess] = useState<string | null>(null)
  const [pendingCreate, setPendingCreate] = useState(false)
  const [topMsg, setTopMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(
    null,
  )

  async function refresh() {
    setLoading(true)
    setLoadError(null)
    try {
      const [u, d, r] = await Promise.all([
        adminApi.listUsers(),
        adminApi.listDepartments().catch(() => ({ departments: [], count: 0 })),
        adminApi.listRoles().catch(() => ({ roles: [], count: 0 })),
      ])
      setUsers(u.users)
      setDepts(d.departments)
      setRoleDefs(r.roles)
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.message : t('admin.loadFailed'),
      )
    } finally {
      setLoading(false)
    }
  }

  // Roles dropdown is sourced from the live registry so newly created
  // custom roles show up immediately. Fallback covers fresh installs
  // before /admin/roles is reachable.
  const availableRoles: { name: string; label: string }[] = useMemo(() => {
    if (roleDefs.length === 0) {
      return FALLBACK_ROLES.map((r) => ({ name: r, label: t(`role.${r}`) }))
    }
    return roleDefs.map((r) => ({
      name: r.name,
      label: r.display_name?.en || r.name,
    }))
  }, [roleDefs, t])

  useEffect(() => {
    refresh()
  }, [])

  const sorted = useMemo(
    () => [...users].sort((a, b) => a.email.localeCompare(b.email)),
    [users],
  )

  const deptName = (id?: string | null) => {
    if (!id) return ''
    const d = depts.find((x) => x.id === id)
    if (!d) return ''
    return d.name.en || d.name.th || d.name.de || d.slug
  }

  function flash(kind: 'ok' | 'err', text: string) {
    setTopMsg({ kind, text })
    setTimeout(() => setTopMsg(null), 3000)
  }

  function onCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreateError(null)
    setCreateSuccess(null)
    if (form.password.length < 8) {
      setCreateError(t('admin.passwordTooShort'))
      return
    }
    if (form.password !== form.password_confirm) {
      setCreateError(t('admin.passwordMismatch'))
      return
    }
    // Two-step confirmation: open the explicit confirm modal so the
    // operator must explicitly approve account creation. Prevents typo-
    // induced lockouts where a freshly-created user can't log in
    // because the only password copy was wrong.
    setPendingCreate(true)
  }

  async function commitCreate() {
    setCreating(true)
    setCreateError(null)
    try {
      await adminApi.createUser({
        email: form.email.trim(),
        password: form.password,
        display_name: form.display_name.trim(),
        locale: 'en',
        roles: [form.role],
        is_active: true,
        department_id: form.department_id || null,
      })
      setCreateSuccess(t('admin.userCreated'))
      setForm({
        email: '',
        display_name: '',
        password: '',
        password_confirm: '',
        locale: 'en',
        role: 'employee',
        department_id: '',
      })
      setPendingCreate(false)
      await refresh()
    } catch (err) {
      setCreateError(
        err instanceof ApiError ? err.message : t('admin.createFailed'),
      )
    } finally {
      setCreating(false)
    }
  }

  async function onChangeRole(u: AdminUser, role: Role) {
    setBusyId(u.id)
    setRowError((p) => ({ ...p, [u.id]: null }))
    try {
      const updated = await adminApi.updateRoles(u.id, [role])
      setUsers((prev) => prev.map((x) => (x.id === u.id ? updated : x)))
    } catch (err) {
      setRowError((p) => ({
        ...p,
        [u.id]: err instanceof ApiError ? err.message : t('admin.updateFailed'),
      }))
    } finally {
      setBusyId(null)
    }
  }

  async function onToggleActive(u: AdminUser) {
    setBusyId(u.id)
    setRowError((p) => ({ ...p, [u.id]: null }))
    try {
      const updated = await adminApi.setActive(u.id, !u.is_active)
      setUsers((prev) => prev.map((x) => (x.id === u.id ? updated : x)))
    } catch (err) {
      setRowError((p) => ({
        ...p,
        [u.id]: err instanceof ApiError ? err.message : t('admin.updateFailed'),
      }))
    } finally {
      setBusyId(null)
    }
  }

  async function onConfirmDelete() {
    if (!deleteTarget) return
    setBusyId(deleteTarget.id)
    try {
      await adminApi.deleteUser(deleteTarget.id)
      setUsers((prev) => prev.filter((x) => x.id !== deleteTarget.id))
      flash('ok', t('admin.userDeleted'))
      setDeleteTarget(null)
    } catch (err) {
      flash(
        'err',
        err instanceof ApiError ? err.message : t('admin.deleteFailed'),
      )
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <h2 className="text-xl font-semibold text-[color:var(--fg)]">
          {t('admin.usersTitle')}
        </h2>
        <span className="text-sm text-[color:var(--muted)]">
          {t('admin.totalUsers', { count: users.length })}
        </span>
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
          <CardTitle>{t('admin.createUserTitle')}</CardTitle>
          <p className="mt-1 text-xs text-[color:var(--muted)]">
            {t('admin.createUserHint')}
          </p>
        </CardHeader>
        <form onSubmit={onCreate}>
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="email">{t('admin.email')}</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="off"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="name@aae.co.th"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="display_name">{t('admin.displayName')}</Label>
              <Input
                id="display_name"
                required
                value={form.display_name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, display_name: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">{t('admin.password')}</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={form.password}
                onChange={(e) =>
                  setForm((f) => ({ ...f, password: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password_confirm">
                {t('admin.passwordConfirm')}
              </Label>
              <Input
                id="password_confirm"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={form.password_confirm}
                onChange={(e) =>
                  setForm((f) => ({ ...f, password_confirm: e.target.value }))
                }
                aria-invalid={
                  form.password_confirm.length > 0 &&
                  form.password_confirm !== form.password
                }
              />
              {form.password_confirm.length > 0 &&
                form.password_confirm !== form.password && (
                  <p className="text-xs text-red-600">
                    {t('admin.passwordMismatch')}
                  </p>
                )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="role">{t('admin.role')}</Label>
              <Select
                id="role"
                value={form.role}
                onChange={(e) =>
                  setForm((f) => ({ ...f, role: e.target.value as Role }))
                }
              >
                {availableRoles.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="department_id">{t('admin.department')}</Label>
              <Select
                id="department_id"
                value={form.department_id}
                onChange={(e) =>
                  setForm((f) => ({ ...f, department_id: e.target.value }))
                }
              >
                <option value="">{t('admin.noDepartment')}</option>
                {depts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name.en || d.name.th || d.name.de || d.slug}
                  </option>
                ))}
              </Select>
            </div>
          </CardBody>
          <CardFooter className="justify-between">
            <div className="text-xs">
              {createError && (
                <span className="text-red-600">{createError}</span>
              )}
              {createSuccess && !createError && (
                <span className="text-green-600">{createSuccess}</span>
              )}
            </div>
            <Button type="submit" loading={creating}>
              {t('admin.createUser')}
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.usersTitle')}</CardTitle>
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
              {t('admin.noUsers')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[color:var(--bg)] text-left text-xs uppercase tracking-wide text-[color:var(--muted)]">
                  <tr>
                    <th className="px-4 py-2">{t('admin.email')}</th>
                    <th className="px-4 py-2">{t('admin.name')}</th>
                    <th className="px-4 py-2">{t('admin.role')}</th>
                    <th className="px-4 py-2">{t('admin.department')}</th>
                    <th className="px-4 py-2">{t('admin.active')}</th>
                    <th className="px-4 py-2 text-right">
                      {t('admin.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((u) => {
                    const primary = (u.roles?.[0] ?? 'employee') as Role
                    const err = rowError[u.id]
                    const isSelf = currentUser?.id === u.id
                    return (
                      <tr
                        key={u.id}
                        className="border-t border-[color:var(--border)] align-top"
                      >
                        <td className="px-4 py-3 font-medium text-[color:var(--fg)]">
                          {u.email}
                          {err && (
                            <div className="mt-1 text-xs text-red-600">
                              {err}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-[color:var(--fg)]">
                          {u.display_name}
                        </td>
                        <td className="px-4 py-3">
                          <Select
                            value={primary}
                            disabled={busyId === u.id}
                            onChange={(e) =>
                              onChangeRole(u, e.target.value as Role)
                            }
                            className="h-9 max-w-[180px]"
                          >
                            {availableRoles.map((r) => (
                              <option key={r.name} value={r.name}>
                                {r.label}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td className="px-4 py-3 text-[color:var(--fg)]">
                          {deptName(u.department_id) || (
                            <span className="text-[color:var(--muted)]">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={
                              u.is_active
                                ? 'text-green-600'
                                : 'text-[color:var(--muted)]'
                            }
                          >
                            {u.is_active
                              ? t('admin.active')
                              : t('admin.inactive')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setEditTarget(u)}
                            >
                              {t('admin.edit')}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setPwTarget(u)}
                            >
                              {t('admin.resetPassword')}
                            </Button>
                            <Button
                              size="sm"
                              variant={u.is_active ? 'outline' : 'primary'}
                              disabled={busyId === u.id}
                              onClick={() => onToggleActive(u)}
                            >
                              {u.is_active
                                ? t('admin.deactivate')
                                : t('admin.activate')}
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={busyId === u.id || isSelf}
                              onClick={() => setDeleteTarget(u)}
                              title={isSelf ? '—' : ''}
                            >
                              {t('admin.delete')}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <EditUserModal
        target={editTarget}
        depts={depts}
        onClose={() => setEditTarget(null)}
        onSaved={(updated) => {
          setUsers((prev) =>
            prev.map((x) => (x.id === updated.id ? updated : x)),
          )
          setEditTarget(null)
          flash('ok', t('admin.userUpdated'))
        }}
        onError={(m) => flash('err', m)}
      />

      <PasswordModal
        target={pwTarget}
        onClose={() => setPwTarget(null)}
        onSaved={() => {
          setPwTarget(null)
          flash('ok', t('admin.passwordReset'))
        }}
        onError={(m) => flash('err', m)}
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
            t('admin.confirmDeleteUser', { email: deleteTarget.email })}
        </p>
      </Modal>

      <Modal
        open={pendingCreate}
        onClose={() => !creating && setPendingCreate(false)}
        title={t('admin.confirmCreateTitle')}
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
              {t('admin.confirmCreate')}
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-[color:var(--fg)]">
          <p>{t('admin.confirmCreateBody', { email: form.email })}</p>
          <p className="text-xs text-[color:var(--muted)]">
            {t('admin.confirmCreateHint')}
          </p>
        </div>
      </Modal>
    </div>
  )
}

function EditUserModal({
  target,
  depts,
  onClose,
  onSaved,
  onError,
}: {
  target: AdminUser | null
  depts: Department[]
  onClose: () => void
  onSaved: (u: AdminUser) => void
  onError: (msg: string) => void
}) {
  const t = useTranslations()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [locale, setLocale] = useState('en')
  const [deptId, setDeptId] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (target) {
      setEmail(target.email)
      setName(target.display_name)
      setLocale(target.preferred_locale)
      setDeptId(target.department_id ?? '')
    }
  }, [target])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!target) return
    setBusy(true)
    try {
      const data: Parameters<typeof adminApi.updateUser>[1] = {
        email: email.trim(),
        display_name: name.trim(),
        preferred_locale: locale,
        department_id: deptId === '' ? null : deptId,
      }
      const updated = await adminApi.updateUser(target.id, data)
      onSaved(updated)
    } catch (err) {
      onError(err instanceof ApiError ? err.message : t('admin.updateFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title={t('admin.editUserTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('admin.cancel')}
          </Button>
          <Button onClick={onSubmit} loading={busy}>
            {t('admin.save')}
          </Button>
        </>
      }
    >
      <form className="grid gap-3" onSubmit={onSubmit}>
        <div className="space-y-1">
          <Label>{t('admin.email')}</Label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <Label>{t('admin.displayName')}</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>{t('admin.locale')}</Label>
            <Select value={locale} onChange={(e) => setLocale(e.target.value)}>
              {LOCALE_OPTIONS.map((l) => (
                <option key={l} value={l}>
                  {l.toUpperCase()}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t('admin.department')}</Label>
            <Select value={deptId} onChange={(e) => setDeptId(e.target.value)}>
              <option value="">{t('admin.noDepartment')}</option>
              {depts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name.en || d.name.th || d.name.de || d.slug}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </form>
    </Modal>
  )
}

function PasswordModal({
  target,
  onClose,
  onSaved,
  onError,
}: {
  target: AdminUser | null
  onClose: () => void
  onSaved: () => void
  onError: (msg: string) => void
}) {
  const t = useTranslations()
  const [pw, setPw] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    if (target) {
      setPw('')
      setPwConfirm('')
      setLocalError(null)
    }
  }, [target])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!target) return
    setLocalError(null)
    if (pw.length < 8) {
      setLocalError(t('admin.passwordTooShort'))
      return
    }
    if (pw !== pwConfirm) {
      setLocalError(t('admin.passwordMismatch'))
      return
    }
    setBusy(true)
    try {
      await adminApi.updatePassword(target.id, pw)
      onSaved()
    } catch (err) {
      onError(err instanceof ApiError ? err.message : t('admin.updateFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title={t('admin.resetPassword')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('admin.cancel')}
          </Button>
          <Button onClick={onSubmit} loading={busy}>
            {t('admin.save')}
          </Button>
        </>
      }
    >
      <form className="space-y-3" onSubmit={onSubmit}>
        <p className="text-sm text-[color:var(--muted)]">{target?.email}</p>
        <div className="space-y-1">
          <Label htmlFor="resetPw">{t('admin.newPassword')}</Label>
          <Input
            id="resetPw"
            type="password"
            value={pw}
            minLength={8}
            onChange={(e) => setPw(e.target.value)}
            autoComplete="new-password"
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="resetPwConfirm">
            {t('admin.passwordConfirm')}
          </Label>
          <Input
            id="resetPwConfirm"
            type="password"
            value={pwConfirm}
            minLength={8}
            onChange={(e) => setPwConfirm(e.target.value)}
            autoComplete="new-password"
            aria-invalid={pwConfirm.length > 0 && pwConfirm !== pw}
            required
          />
        </div>
        {localError && (
          <p className="text-xs text-red-600">{localError}</p>
        )}
        <p className="text-xs text-[color:var(--muted)]">
          {t('admin.confirmCreateHint')}
        </p>
      </form>
    </Modal>
  )
}
