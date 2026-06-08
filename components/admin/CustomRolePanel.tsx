'use client'

import { useCallback, useEffect, useState } from 'react'
import { Shield, Plus, RefreshCw, Trash2, Pencil, Users, KeyRound, X } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import { toast } from '@/lib/ui/toast'

interface Role {
  id: string; workspace_id: string; name: string; description: string
  permissions: string[]; is_system: boolean; created_at: number
}

interface Assignment { id: string; role_id: string; user_id: string }

/** Known permission catalog (flat, Slack-like strings) offered in the multiselect. */
const KNOWN_PERMISSIONS = [
  'channels:read', 'channels:manage', 'channels:archive', 'messages:read', 'messages:write', 'messages:delete',
  'users:read', 'users:invite', 'users:manage', 'users:deactivate', 'files:read', 'files:manage',
  'roles:manage', 'audit:read', 'compliance:manage', 'webhooks:manage', 'workflows:manage', 'settings:manage',
] as const

interface ModalState {
  open: boolean; roleId: string | null; name: string; description: string; permissions: Set<string>
}

const emptyModal: ModalState = { open: false, roleId: null, name: '', description: '', permissions: new Set() }

export default function CustomRolePanel({ onClose }: { onClose: () => void }) {
  const [workspaceId, setWorkspaceId] = useState('')
  const [roles, setRoles] = useState<Role[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modal, setModal] = useState<ModalState>(emptyModal)
  const [saving, setSaving] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await apiFetch('/api/workspaces')
        if (res.ok) {
          const data = (await res.json()) as { teams?: { id: string }[] }
          if (data.teams?.length) setWorkspaceId(data.teams[0].id)
          else setError('No workspace available.')
        } else setError('Failed to resolve workspace.')
      } catch { setError('Failed to resolve workspace.') }
    })()
  }, [])

  const load = useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    setError('')
    try {
      const wq = encodeURIComponent(workspaceId)
      const [rRes, aRes] = await Promise.all([
        apiFetch(`/api/admin/roles?workspace_id=${wq}`),
        apiFetch(`/api/admin/roles/assignments?workspace_id=${wq}`),
      ])
      if (!rRes.ok) {
        setError(rRes.status === 403 ? 'You do not have permission to view roles.' : 'Failed to load roles.')
        return
      }
      const rData = (await rRes.json()) as { roles?: Role[] }
      setRoles((rData.roles || []).map(r => ({ ...r, permissions: r.permissions || [] })))
      const tally: Record<string, number> = {}
      if (aRes.ok) {
        const aData = (await aRes.json()) as { assignments?: Assignment[] }
        for (const a of aData.assignments || []) tally[a.role_id] = (tally[a.role_id] || 0) + 1
      }
      setCounts(tally)
    } catch {
      setError('Failed to load roles.')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => { void load() }, [load])

  const openCreate = () => setModal({ ...emptyModal, open: true })
  const openEdit = (r: Role) => setModal({ open: true, roleId: r.id, name: r.name, description: r.description || '', permissions: new Set(r.permissions) })

  const togglePerm = (p: string) => setModal(m => {
    const next = new Set(m.permissions)
    if (next.has(p)) next.delete(p); else next.add(p)
    return { ...m, permissions: next }
  })

  const handleSave = async () => {
    const name = modal.name.trim()
    if (name.length < 2) { toast.error('Name must be at least 2 characters.'); return }
    setSaving(true)
    try {
      const description = modal.description.trim()
      const permissions = [...modal.permissions]
      const body = modal.roleId
        ? { role_id: modal.roleId, name, description, permissions }
        : { workspace_id: workspaceId, name, description, permissions }
      const res = await apiFetch('/api/admin/roles', {
        method: modal.roleId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(data.error === 'workspace_id_and_name_required' ? 'Name is required.' : `Failed to save role (${data.error || res.status}).`)
        return
      }
      toast.success(modal.roleId ? 'Role updated.' : 'Role created.')
      setModal(emptyModal)
      void load()
    } catch {
      toast.error('Failed to save role.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    setConfirmDeleteId(null)
    try {
      const res = await apiFetch('/api/admin/roles', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role_id: id }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(data.error === 'cannot_delete_system_role' ? 'System roles cannot be deleted.' : 'Failed to delete role.')
        return
      }
      toast.success('Role deleted.')
      void load()
    } catch {
      toast.error('Failed to delete role.')
    }
  }

  return (
    <div className="admin-section">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Shield size={16} style={{ color: 'var(--aae-accent, var(--aae-link))' }} />
        <h3 style={{ margin: 0 }}>Custom Roles</h3>
        <div style={{ flex: 1 }} />
        <button type="button" className="ghost-button" onClick={() => void load()} style={{ fontSize: 13 }}>
          <RefreshCw size={12} style={{ marginRight: 4 }} /> Refresh
        </button>
        <button type="button" className="primary-button" style={{ padding: '5px 14px', fontSize: 13 }} disabled={!workspaceId} onClick={openCreate}>
          <Plus size={13} style={{ marginRight: 4 }} /> New Role
        </button>
        <button type="button" className="ghost-button" onClick={onClose} style={{ fontSize: 13 }} title="Close">
          <X size={14} />
        </button>
      </div>

      <p className="mm-editor-hint" style={{ marginBottom: 12 }}>
        Define workspace-scoped roles with granular permissions. System roles are read-only.
      </p>

      {error && <p className="form-error">{error}</p>}

      <table className="admin-table">
        <thead>
          <tr>
            <th>Role</th>
            <th style={{ textAlign: 'center' }}>Permissions</th>
            <th style={{ textAlign: 'center' }}>Members</th>
            <th style={{ width: 90 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={4} style={{ textAlign: 'center', padding: 16 }}>Loading…</td></tr>
          ) : roles.length === 0 ? (
            <tr><td colSpan={4} style={{ textAlign: 'center', padding: 16, color: 'var(--mm-muted)' }}>No roles defined yet.</td></tr>
          ) : roles.map(r => (
            <tr key={r.id}>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Shield size={14} style={{ color: 'var(--mm-muted)', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {r.name}{r.is_system && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--mm-muted)' }}>(system)</span>}
                    </div>
                    {r.description && <div style={{ fontSize: 12, color: 'var(--mm-muted)' }}>{r.description}</div>}
                  </div>
                </div>
              </td>
              <td style={{ textAlign: 'center' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                  <KeyRound size={13} style={{ color: 'var(--mm-muted)' }} />{r.permissions.length}
                </span>
              </td>
              <td style={{ textAlign: 'center' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                  <Users size={13} style={{ color: 'var(--mm-muted)' }} />{counts[r.id] || 0}
                </span>
              </td>
              <td>
                {r.is_system ? (
                  <span style={{ fontSize: 12, color: 'var(--mm-muted)' }}>—</span>
                ) : confirmDeleteId === r.id ? (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button type="button" className="ghost-button" style={{ color: 'var(--mm-danger)', fontSize: 12 }} onClick={() => void handleDelete(r.id)}>Confirm</button>
                    <button type="button" className="ghost-button" style={{ fontSize: 12 }} onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button type="button" className="ghost-button" style={{ fontSize: 12 }} onClick={() => openEdit(r)} title="Edit role"><Pencil size={13} /></button>
                    <button type="button" className="ghost-button" style={{ color: 'var(--mm-danger)', fontSize: 12 }} onClick={() => setConfirmDeleteId(r.id)} title="Delete role"><Trash2 size={13} /></button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {modal.open && (
        <div className="admin-modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => !saving && setModal(emptyModal)}>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--mm-border-subtle)', borderRadius: 10, padding: 18, width: 480, maxWidth: '92vw', maxHeight: '88vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Shield size={15} style={{ color: 'var(--aae-link)' }} />
              <h4 style={{ margin: 0 }}>{modal.roleId ? 'Edit Role' : 'New Role'}</h4>
            </div>
            <input className="slack-input" placeholder="Role name" value={modal.name} autoFocus
              onChange={e => setModal(m => ({ ...m, name: e.target.value }))} style={{ width: '100%', marginBottom: 8 }} />
            <input className="slack-input" placeholder="Description (optional)" value={modal.description}
              onChange={e => setModal(m => ({ ...m, description: e.target.value }))} style={{ width: '100%', marginBottom: 12 }} />
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--mm-muted)' }}>Permissions</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {KNOWN_PERMISSIONS.map(p => (
                <button key={p} type="button" onClick={() => togglePerm(p)} style={{ fontSize: 12, padding: '3px 10px', borderRadius: 14, cursor: 'pointer', border: `1px solid ${modal.permissions.has(p) ? 'var(--aae-link)' : 'var(--mm-border-subtle)'}`, background: modal.permissions.has(p) ? 'var(--aae-link)' : 'transparent', color: modal.permissions.has(p) ? '#fff' : 'var(--mm-muted)' }}>{p}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="ghost-button" style={{ fontSize: 13 }} disabled={saving} onClick={() => setModal(emptyModal)}>Cancel</button>
              <button type="button" className="primary-button" style={{ fontSize: 13, padding: '5px 16px' }} disabled={saving} onClick={() => void handleSave()}>
                {saving ? 'Saving…' : modal.roleId ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
