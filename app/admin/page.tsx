'use client'

import Link from 'next/link'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { AlertCircle, Download, Search, BarChart3 } from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'
import { isPlatformAdmin, isSuperAdmin } from '@/lib/platformRole'
import AuditLogPanel from '@/app/components/admin/AuditLogPanel'
import { WebhookManagementPanel } from '@/app/components/admin/WebhookManagementPanel'
import { WorkflowManagementPanel } from '@/app/components/admin/WorkflowManagementPanel'
import { DepartmentManagementPanel } from '@/app/components/admin/DepartmentManagementPanel'
import { OAuthAppsPanel } from '@/app/components/admin/OAuthAppsPanel'
import { MigrationPanel } from '@/app/components/admin/MigrationPanel'
import { FunctionsPanel } from '@/app/components/admin/FunctionsPanel'
import { ObservabilityPanel } from '@/app/components/admin/ObservabilityPanel'

type Me = { platform_role?: string }

type AccountReq = {
  id: string
  created_at: string | number
  full_name: string
  work_email: string
  work_phone: string
  note: string
  status: string
  verified_at?: string | number | null
}

type UserRow = {
  id: string
  username: string
  email: string
  first_name: string
  last_name: string
  platform_role: string
  created_at: string | number
}

type EmergencyQueueRow = {
  id: string
  user_id: string
  username: string
  email: string
  body: string
  created_at: number
  status: string
}

export default function AdminPage() {
  const router = useRouter()
  const [me, setMe] = useState<Me | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [requests, setRequests] = useState<AccountReq[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [loadErr, setLoadErr] = useState('')
  const [busyId, setBusyId] = useState('')
  const [issued, setIssued] = useState<{ ref: string; code: string; expires: number } | null>(null)

  const [uUsername, setUUsername] = useState('')
  const [uEmail, setUEmail] = useState('')
  const [uPassword, setUPassword] = useState('')
  const [uFirst, setUFirst] = useState('')
  const [uLast, setULast] = useState('')
  const [uRole, setURole] = useState('employee')
  const [createBusy, setCreateBusy] = useState(false)
  const [createMsg, setCreateMsg] = useState('')
  const [itOnline, setItOnline] = useState(false)
  const [itPresenceBusy, setItPresenceBusy] = useState(false)
  const [emergencyRows, setEmergencyRows] = useState<EmergencyQueueRow[]>([])
  const [editingUser, setEditingUser] = useState<UserRow | null>(null)
  const [editRole, setEditRole] = useState('')
  const [editBusy, setEditBusy] = useState(false)
  const [editMsg, setEditMsg] = useState('')
  const [userSearch, setUserSearch] = useState('')
  const [stats, setStats] = useState<{ user_count: number; active_today: number; channel_count: number; message_count: number; messages_today: number; session_count: number } | null>(null)
  const issuedPanelRef = useRef<HTMLDivElement>(null)
  const issuedCopyRef = useRef<HTMLButtonElement>(null)
  const priorFocusBeforeIssuedRef = useRef<HTMLElement | null>(null)

  const loadAll = useCallback(async () => {
    setLoadErr('')
    const rMe = await apiFetch('/api/auth/me')
    if (rMe.status === 401) {
      router.replace('/login')
      return
    }
    if (!rMe.ok) {
      setForbidden(true)
      return
    }
    const mj = (await rMe.json()) as { user?: Me }
    const role = mj.user?.platform_role
    if (!isPlatformAdmin(role)) {
      setForbidden(true)
      return
    }
    setMe(mj.user ?? {})
    const [rReq, rUsers, rPres, rEmerg] = await Promise.all([
      apiFetch('/api/admin/account-requests'),
      apiFetch('/api/admin/users'),
      apiFetch('/api/admin/support-presence'),
      apiFetch('/api/admin/support-emergency')
    ])
    if (rReq.status === 403 || rUsers.status === 403) {
      setForbidden(true)
      return
    }
    if (!rReq.ok || !rUsers.ok) {
      setLoadErr('Could not load admin data. Try again.')
      return
    }
    const reqJ = (await rReq.json()) as { requests?: AccountReq[] }
    const usrJ = (await rUsers.json()) as { users?: UserRow[] }
    setRequests(reqJ.requests ?? [])
    setUsers(usrJ.users ?? [])
    if (rPres.ok) {
      const pj = (await rPres.json()) as { is_online?: boolean }
      setItOnline(Boolean(pj.is_online))
    }
    if (rEmerg.ok) {
      const ej = (await rEmerg.json()) as { messages?: EmergencyQueueRow[] }
      setEmergencyRows(ej.messages ?? [])
    }
    // Load stats
    try {
      const rStats = await apiFetch('/api/admin/stats')
      if (rStats.ok) {
        const sj = await rStats.json() as { stats?: typeof stats }
        if (sj.stats) setStats(sj.stats)
      }
    } catch { /* non-critical */ }
  }, [router])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  useEffect(() => {
    if (issued == null) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = window.setTimeout(() => issuedCopyRef.current?.focus(), 0)
    return () => {
      window.clearTimeout(t)
      document.body.style.overflow = prev
    }
  }, [issued])

  useLayoutEffect(() => {
    if (issued !== null) return
    const el = priorFocusBeforeIssuedRef.current
    priorFocusBeforeIssuedRef.current = null
    if (!el || !document.contains(el)) return
    try {
      el.focus({ preventScroll: true })
    } catch {
      /* ignore */
    }
  }, [issued])

  useEffect(() => {
    if (issued == null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setIssued(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [issued])

  useEffect(() => {
    const panel = issuedPanelRef.current
    if (!panel || issued == null) return

    const focusables = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter(el => el.offsetParent !== null || el === document.activeElement)

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const active = document.activeElement
      if (!active || !panel.contains(active)) return
      const nodes = focusables()
      if (nodes.length === 0) return
      if (nodes.length === 1) {
        e.preventDefault()
        nodes[0].focus()
        return
      }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (e.shiftKey) {
        if (active === first) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [issued])

  async function issueCode(id: string) {
    setBusyId(id)
    setIssued(null)
    const res = await apiFetch(`/api/admin/account-requests/${encodeURIComponent(id)}/issue-code`, { method: 'POST' })
    setBusyId('')
    if (!res.ok) {
      setLoadErr('Could not create a code. The request may no longer be pending.')
      void loadAll()
      return
    }
    const data = (await res.json()) as { code?: string; expires_at?: number }
    if (data.code) {
      const a = document.activeElement
      priorFocusBeforeIssuedRef.current = a instanceof HTMLElement ? a : null
      setIssued({ ref: id, code: data.code, expires: Number(data.expires_at) || 0 })
    }
    void loadAll()
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault()
    setCreateBusy(true)
    setCreateMsg('')
    const res = await apiFetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: uUsername.trim(),
        email: uEmail.trim(),
        password: uPassword,
        first_name: uFirst.trim(),
        last_name: uLast.trim(),
        platform_role: uRole
      })
    })
    setCreateBusy(false)
    if (res.status === 403) {
      setCreateMsg('You cannot assign that role. Choose another or ask a super administrator.')
      return
    }
    if (res.status === 409) {
      setCreateMsg('That user name or email is already in use.')
      return
    }
    if (!res.ok) {
      setCreateMsg('Check all fields: user name at least 2 characters, valid work email, password at least 8 characters.')
      return
    }
    setCreateMsg('Account created. Give the person their sign-in details through your usual secure channel.')
    setUUsername('')
    setUEmail('')
    setUPassword('')
    setUFirst('')
    setULast('')
    setURole('employee')
    void loadAll()
  }

  function copyCode() {
    if (!issued?.code) return
    void navigator.clipboard.writeText(issued.code)
  }

  async function patchItPresence(next: boolean) {
    setItPresenceBusy(true)
    setLoadErr('')
    const res = await apiFetch('/api/admin/support-presence', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_online: next })
    })
    setItPresenceBusy(false)
    if (!res.ok) {
      setLoadErr('Could not update IT desk status.')
      return
    }
    const j = (await res.json()) as { is_online?: boolean }
    setItOnline(Boolean(j.is_online))
  }

  if (forbidden) {
    return (
      <main className="aae-auth-page">
        <div className="aae-auth-card">
          <div className="slack-card mm-auth-form" style={{ padding: '28px 28px' }}>
            <h1 className="aae-auth-title">No access</h1>
            <p className="aae-auth-lead">This area is only for organization administrators.</p>
            <Link href="/home" className="slack-button" style={{ display: 'inline-block', marginTop: 16 }}>
              Back to AAELink
            </Link>
          </div>
        </div>
      </main>
    )
  }

  const superUser = isSuperAdmin(me?.platform_role)
  const roleOptions = superUser
    ? [
      { value: 'employee', label: 'Standard member' },
      { value: 'it_employee', label: 'IT support member' },
      { value: 'it_admin', label: 'IT administrator' }
    ]
    : [
      { value: 'employee', label: 'Standard member' },
      { value: 'it_employee', label: 'IT support member' }
    ]

  return (
    <>
      <main className="aae-auth-page" inert={issued != null ? true : undefined}>
        <div className="aae-auth-card aae-auth-card--wide" style={{ margin: '0 auto' }}>
          <p style={{ margin: '0 0 12px' }}>
            <Link href="/home" className="link-button">
              Back to app
            </Link>
          </p>
          <div className="slack-card mm-auth-form" style={{ padding: '28px 28px' }}>
            <h1 className="aae-auth-title">Organization admin</h1>
            <p className="aae-auth-lead" style={{ marginBottom: 20 }}>
              Review access requests, send one-time confirmation codes, and create sign-ins for new colleagues. Share passwords only through approved channels.
            </p>
            {loadErr ? (
              <div className="mm-auth-alert mm-auth-alert--error" role="alert" style={{ marginBottom: 16 }}>
                <AlertCircle size={18} strokeWidth={2} aria-hidden />
                <span>{loadErr}</span>
              </div>
            ) : null}

            <section style={{ marginBottom: 28 }}>
            <h2 className="mm-auth-section-title">
              Access requests
            </h2>
            {requests.length === 0 ? (
              <p className="doc-muted">No pending requests in the list.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
                      <th style={{ padding: '8px 6px' }}>When</th>
                      <th style={{ padding: '8px 6px' }}>Name</th>
                      <th style={{ padding: '8px 6px' }}>Work email</th>
                      <th style={{ padding: '8px 6px' }}>Status</th>
                      <th style={{ padding: '8px 6px' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map(r => (
                      <tr key={r.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                        <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                          {r.created_at ? new Date(Number(r.created_at) || r.created_at).toLocaleString() : ''}
                        </td>
                        <td style={{ padding: '8px 6px' }}>{r.full_name}</td>
                        <td style={{ padding: '8px 6px' }}>{r.work_email}</td>
                        <td style={{ padding: '8px 6px' }}>{r.status}</td>
                        <td style={{ padding: '8px 6px' }}>
                          {r.status === 'pending' ? (
                            <button
                              type="button"
                              className="slack-button"
                              style={{ padding: '6px 12px', fontSize: 13 }}
                              disabled={busyId === r.id}
                              onClick={() => void issueCode(r.id)}
                            >
                              {busyId === r.id ? 'Working…' : 'Issue code'}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h2 className="mm-auth-section-title">
              Create sign-in
            </h2>
            <p className="aae-auth-lead" style={{ marginBottom: 14 }}>
              New accounts are added to the main organization workspace automatically. The person should change their password after first sign-in if your policy requires it.
            </p>
            <form onSubmit={createUser} style={{ display: 'grid', gap: 12, maxWidth: 480 }}>
              <label className="field-label" htmlFor="aae-admin-username">
                User name
                <input
                  id="aae-admin-username"
                  className="slack-input"
                  value={uUsername}
                  onChange={e => setUUsername(e.target.value)}
                  required
                  autoComplete="off"
                />
              </label>
              <label className="field-label" htmlFor="aae-admin-email">
                Work email
                <input
                  id="aae-admin-email"
                  className="slack-input"
                  type="email"
                  value={uEmail}
                  onChange={e => setUEmail(e.target.value)}
                  required
                  autoComplete="off"
                />
              </label>
              <label className="field-label" htmlFor="aae-admin-password">
                Initial password
                <input
                  id="aae-admin-password"
                  className="slack-input"
                  type="password"
                  value={uPassword}
                  onChange={e => setUPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </label>
              <label className="field-label" htmlFor="aae-admin-first">
                First name
                <input id="aae-admin-first" className="slack-input" value={uFirst} onChange={e => setUFirst(e.target.value)} />
              </label>
              <label className="field-label" htmlFor="aae-admin-last">
                Last name
                <input id="aae-admin-last" className="slack-input" value={uLast} onChange={e => setULast(e.target.value)} />
              </label>
              <label className="field-label" htmlFor="aae-admin-role">
                Role
                <select id="aae-admin-role" className="slack-input" value={uRole} onChange={e => setURole(e.target.value)}>
                  {roleOptions.map(o => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              {createMsg ? (
                createMsg.includes('Account created') ? (
                  <div className="mm-auth-alert mm-auth-alert--info" role="status">
                    {createMsg}
                  </div>
                ) : (
                  <div className="mm-auth-alert mm-auth-alert--error" role="alert">
                    <AlertCircle size={18} strokeWidth={2} aria-hidden />
                    <span>{createMsg}</span>
                  </div>
                )
              ) : null}
              <button className="slack-button" type="submit" disabled={createBusy} style={{ justifySelf: 'start' }}>
                {createBusy ? 'Creating…' : 'Create account'}
              </button>
            </form>
          </section>

          <section style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid rgba(0, 89, 150, 0.12)' }}>
            <h2 className="mm-auth-section-title">
              IT desk presence
            </h2>
            <p className="aae-auth-lead" style={{ marginBottom: 12 }}>
              When you are online here, members who complete verification can open live chat (if configured). When offline, they still see phone, email, and the urgent message queue.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600 }}>{itOnline ? 'Online' : 'Offline'}</span>
              <button
                type="button"
                className="slack-button"
                style={{ padding: '6px 14px', fontSize: 13 }}
                disabled={itPresenceBusy}
                onClick={() => void patchItPresence(!itOnline)}
              >
                {itPresenceBusy ? 'Saving' : itOnline ? 'Go offline' : 'Go online'}
              </button>
            </div>
          </section>

          <section style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid rgba(0, 89, 150, 0.12)' }}>
            <h2 className="mm-auth-section-title">
              Urgent IT messages
            </h2>
            {emergencyRows.length === 0 ? (
              <p className="doc-muted">No messages in the queue.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
                      <th style={{ padding: '6px' }}>When</th>
                      <th style={{ padding: '6px' }}>From</th>
                      <th style={{ padding: '6px' }}>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emergencyRows.map(m => (
                      <tr key={m.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)', verticalAlign: 'top' }}>
                        <td style={{ padding: '6px', whiteSpace: 'nowrap' }}>
                          {m.created_at ? new Date(m.created_at).toLocaleString() : ''}
                        </td>
                        <td style={{ padding: '6px' }}>
                          @{m.username}
                          <br />
                          <span className="doc-muted">{m.email}</span>
                        </td>
                        <td style={{ padding: '6px', maxWidth: 360, whiteSpace: 'pre-wrap' }}>{m.body}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ── Platform Stats ──────────────────────────────────── */}
          {stats && (
            <section style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid rgba(0, 89, 150, 0.12)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <BarChart3 size={16} style={{ color: 'var(--aae-accent, var(--aae-link))' }} />
                <h2 className="mm-auth-section-title" style={{ margin: 0 }}>Platform Overview</h2>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
                {[
                  { label: 'Total Users', value: stats.user_count },
                  { label: 'Active Today', value: stats.active_today },
                  { label: 'Channels', value: stats.channel_count },
                  { label: 'Messages', value: stats.message_count.toLocaleString() },
                  { label: 'Messages Today', value: stats.messages_today },
                  { label: 'Active Sessions', value: stats.session_count },
                ].map(s => (
                  <div key={s.label} style={{ padding: '14px 16px', borderRadius: 8, background: 'var(--mm-bg-secondary, #f8f9fa)', textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--aae-accent, var(--aae-link))' }}>{s.value}</div>
                    <div style={{ fontSize: 11, color: 'var(--mm-muted)', marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid rgba(0, 89, 150, 0.12)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <h2 className="mm-auth-section-title" style={{ margin: 0 }}>
                Recent accounts
              </h2>
              <span style={{ fontSize: 11, color: 'var(--mm-muted)' }}>({users.length})</span>
              <span style={{ flex: 1 }} />
              <div className="mm-forward-search" style={{ width: 180, flex: 'none' }}>
                <Search size={12} />
                <input type="search" placeholder="Filter users…" value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 12 }} />
              </div>
              <a href="/api/admin/users/export" download className="ghost-button"
                style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
                <Download size={12} /> CSV
              </a>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
                    <th style={{ padding: '6px' }}>User name</th>
                    <th style={{ padding: '6px' }}>Name</th>
                    <th style={{ padding: '6px' }}>Email</th>
                    <th style={{ padding: '6px' }}>Role</th>
                    <th style={{ padding: '6px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.filter(u => {
                  if (!userSearch.trim()) return true
                  const q = userSearch.toLowerCase()
                  return u.username.toLowerCase().includes(q)
                    || u.email.toLowerCase().includes(q)
                    || `${u.first_name} ${u.last_name}`.toLowerCase().includes(q)
                }).slice(0, 40).map(u => (
                    <tr key={u.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                      <td style={{ padding: '6px' }}>@{u.username}</td>
                      <td style={{ padding: '6px' }}>{[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}</td>
                      <td style={{ padding: '6px' }}>{u.email}</td>
                      <td style={{ padding: '6px' }}>
                        <span className={`mm-settings-role-badge${u.platform_role === 'super_admin' ? ' mm-settings-role-badge--admin' : u.platform_role === 'it_admin' ? ' mm-settings-role-badge--admin' : ''}`}>
                          {u.platform_role === 'super_admin' ? 'Super Admin'
                            : u.platform_role === 'it_admin' ? 'IT Admin'
                            : u.platform_role === 'it_support' ? 'IT Support'
                            : u.platform_role === 'it_employee' ? 'IT Employee'
                            : 'Employee'}
                        </span>
                      </td>
                      <td style={{ padding: '6px' }}>
                        <button type="button" className="ghost-button" style={{ fontSize: 12, padding: '3px 8px' }}
                          onClick={() => setEditingUser(u)}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid rgba(0, 89, 150, 0.12)' }}>
            <DepartmentManagementPanel />
          </section>

          {/* ── Audit Log ─────────────────────────────────────── */}
          <section style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid rgba(0, 89, 150, 0.12)' }}>
            <AuditLogPanel />
          </section>

          <section style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid rgba(0, 89, 150, 0.12)' }}>
            <h2 className="mm-auth-section-title">
              Workflow management
            </h2>
            <WorkflowManagementPanel />
          </section>

          {/* ── Webhook Management ────────────────────────────── */}
          <section style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid rgba(0, 89, 150, 0.12)' }}>
            <WebhookManagementPanel workspaceId="" />
          </section>

          {/* ── OAuth Apps ────────────────────────────────────── */}
          <section style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid rgba(0, 89, 150, 0.12)' }}>
            <OAuthAppsPanel />
          </section>

          {/* ── Custom Functions ──────────────────────────────── */}
          <section style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid rgba(0, 89, 150, 0.12)' }}>
            <FunctionsPanel />
          </section>

          {/* ── Platform Migration ────────────────────────────── */}
          {superUser && (
            <section style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid rgba(0, 89, 150, 0.12)' }}>
              <MigrationPanel />
            </section>
          )}

          {/* ── Observability & Tracing ────────────────────────── */}
          <section style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid rgba(0, 89, 150, 0.12)' }}>
            <ObservabilityPanel />
          </section>
          </div>
        </div>
      </main>

      {issued && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="mm-modal-overlay"
              role="presentation"
              onClick={e => {
                if (e.target === e.currentTarget) setIssued(null)
              }}
            >
              <div
                ref={issuedPanelRef}
                className="mm-modal"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="admin-issued-title"
                aria-describedby="admin-issued-desc"
                onClick={e => e.stopPropagation()}
              >
                <h2 id="admin-issued-title">One-time code for the requester</h2>
                <p id="admin-issued-desc" className="mm-editor-hint" style={{ marginTop: 10 }}>
                  {issued.expires
                    ? `Valid until ${new Date(issued.expires).toLocaleString()}.`
                    : 'Valid for a limited time.'}{' '}
                  Tell them to enter it on the Request access page with their work email.
                </p>
                <p style={{ margin: '14px 0 0', fontSize: 28, letterSpacing: 4, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {issued.code}
                </p>
                <div className="mm-modal-actions">
                  <button ref={issuedCopyRef} type="button" className="slack-button" onClick={() => void copyCode()}>
                    Copy code
                  </button>
                  <button type="button" className="ghost-button" onClick={() => setIssued(null)}>
                    Done
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {/* User role edit modal */}
      {editingUser && typeof document !== 'undefined'
        ? createPortal(
            <div className="admin-user-edit-modal" role="presentation"
              onClick={e => { if (e.target === e.currentTarget) { setEditingUser(null); setEditMsg('') } }}>
              <div className="admin-user-edit-card" role="dialog" aria-modal="true">
                <h3>Edit User — @{editingUser.username}</h3>
                <div className="mm-settings-form-row" style={{ marginBottom: 12 }}>
                  <label className="mm-settings-form-label" htmlFor="edit-role">Platform Role</label>
                  <select id="edit-role" className="admin-role-select"
                    value={editRole || editingUser.platform_role || 'employee'}
                    onChange={e => setEditRole(e.target.value)}>
                    <option value="employee">Employee</option>
                    <option value="it_employee">IT Employee</option>
                    <option value="it_support">IT Support</option>
                    {isSuperAdmin(me?.platform_role) && <option value="it_admin">IT Admin</option>}
                    {isSuperAdmin(me?.platform_role) && <option value="super_admin">Super Admin</option>}
                  </select>
                </div>
                {editMsg && (
                  <div className={`mm-auth-alert ${editMsg.startsWith('Error') ? 'mm-auth-alert--error' : 'mm-auth-alert--success'}`}
                    role="alert" style={{ marginBottom: 12, fontSize: 12 }}>
                    <span>{editMsg}</span>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" className="ghost-button"
                    onClick={() => { setEditingUser(null); setEditMsg(''); setEditRole('') }}>
                    Cancel
                  </button>
                  <button type="button" className="slack-button" disabled={editBusy}
                    onClick={async () => {
                      const role = editRole || editingUser.platform_role || 'employee'
                      setEditBusy(true)
                      setEditMsg('')
                      try {
                        const res = await apiFetch('/api/admin/users', {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ user_id: editingUser.id, platform_role: role })
                        })
                        if (!res.ok) {
                          const d = await res.json().catch(() => ({})) as { error?: string }
                          setEditMsg(`Error: ${d.error || 'save failed'}`)
                        } else {
                          setEditMsg('Saved successfully!')
                          // Refresh user list
                          const r2 = await apiFetch('/api/admin/users')
                          if (r2.ok) {
                            const d2 = await r2.json() as { users?: UserRow[] }
                            if (d2.users) setUsers(d2.users)
                          }
                          setTimeout(() => { setEditingUser(null); setEditMsg(''); setEditRole('') }, 1200)
                        }
                      } catch {
                        setEditMsg('Error: network error')
                      } finally {
                        setEditBusy(false)
                      }
                    }}>
                    {editBusy ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
