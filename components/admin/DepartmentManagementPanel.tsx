'use client'

import { useCallback, useEffect, useState } from 'react'
import { Building2, Plus, RefreshCw, Users, Trash2, Pencil, Check, X } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import { toast } from '@/lib/ui/toast'

interface Department {
  id: string
  workspace_id: string
  code: string
  name: string
  member_count: number
  created_at: number
}

interface RowProps {
  dep: Department
  editing: boolean
  editName: string
  savingEdit: boolean
  confirmingDelete: boolean
  deleting: boolean
  onEditNameChange: (v: string) => void
  onStartEdit: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onAskDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
}

/* Single department table row: view, inline rename, and delete-confirm states. */
function DepartmentRow(p: RowProps) {
  const { dep: d } = p
  return (
    <tr>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Building2 size={14} style={{ color: 'var(--mm-muted)', flexShrink: 0 }} />
          {p.editing ? (
            <input
              className="slack-input"
              value={p.editName}
              onChange={e => p.onEditNameChange(e.target.value)}
              style={{ fontSize: 13, padding: '3px 8px', minWidth: 140 }}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') p.onSaveEdit() }}
            />
          ) : (
            <span style={{ fontWeight: 600, fontSize: 13 }}>{d.name}</span>
          )}
        </div>
      </td>
      <td style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--mm-muted)' }}>{d.code}</td>
      <td style={{ textAlign: 'center' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
          <Users size={13} style={{ color: 'var(--mm-muted)' }} />
          {d.member_count ?? 0}
        </span>
      </td>
      <td style={{ fontSize: 12, color: 'var(--mm-muted)', whiteSpace: 'nowrap' }}>
        {new Date(d.created_at).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })}
      </td>
      <td>
        {p.editing ? (
          <div style={{ display: 'flex', gap: 4 }}>
            <button type="button" className="ghost-button" style={{ color: 'var(--aae-link)', fontSize: 12 }}
              disabled={p.savingEdit} onClick={p.onSaveEdit} title="Save">
              <Check size={13} />
            </button>
            <button type="button" className="ghost-button" style={{ fontSize: 12 }}
              disabled={p.savingEdit} onClick={p.onCancelEdit} title="Cancel">
              <X size={13} />
            </button>
          </div>
        ) : p.confirmingDelete ? (
          <div style={{ display: 'flex', gap: 4 }}>
            <button type="button" className="ghost-button" style={{ color: 'var(--mm-danger)', fontSize: 12 }}
              disabled={p.deleting} onClick={p.onConfirmDelete}>Confirm</button>
            <button type="button" className="ghost-button" style={{ fontSize: 12 }}
              onClick={p.onCancelDelete}>Cancel</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 4 }}>
            <button type="button" className="ghost-button" style={{ fontSize: 12 }}
              onClick={p.onStartEdit} title="Rename department">
              <Pencil size={13} />
            </button>
            <button type="button" className="ghost-button" style={{ color: 'var(--mm-danger)', fontSize: 12 }}
              onClick={p.onAskDelete} title="Delete department">
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}

export function DepartmentManagementPanel() {
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCode, setNewCode] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/api/admin/departments')
      if (!res.ok) {
        const code = res.status === 403
          ? 'You do not have permission to view departments.'
          : 'Failed to load departments.'
        setError(code)
        return
      }
      const data = await res.json()
      setDepartments((data.departments || []) as Department[])
    } catch {
      setError('Failed to load departments.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const handleCreate = async () => {
    const trimName = newName.trim()
    if (trimName.length < 2) {
      setCreateError('Name must be at least 2 characters.')
      return
    }
    setCreating(true)
    setCreateError('')
    try {
      const res = await apiFetch('/api/admin/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimName, code: newCode.trim() || undefined })
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        const msg = data.error === 'department_already_exists'
          ? 'A department with this code already exists.'
          : data.error === 'name_required'
            ? 'Name must be at least 2 characters.'
            : 'Failed to create department.'
        setCreateError(msg)
        toast.error(msg)
        return
      }
      setNewName('')
      setNewCode('')
      setCreateOpen(false)
      toast.success('Department created.')
      void load()
    } catch {
      setCreateError('Network error.')
      toast.error('Network error.')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    setConfirmDeleteId(null)
    setDeletingId(id)
    try {
      const res = await apiFetch(`/api/admin/departments?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) {
        toast.error('Failed to delete department.')
        return
      }
      toast.success('Department deleted.')
      void load()
    } catch {
      toast.error('Failed to delete department.')
    } finally {
      setDeletingId(null)
    }
  }

  const startEdit = (d: Department) => {
    setConfirmDeleteId(null)
    setEditId(d.id)
    setEditName(d.name)
  }

  const handleSaveEdit = async (id: string) => {
    const trimName = editName.trim()
    if (trimName.length < 2) {
      toast.error('Name must be at least 2 characters.')
      return
    }
    setSavingEdit(true)
    try {
      const res = await apiFetch('/api/admin/departments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name: trimName })
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(data.error === 'not_found' ? 'Department no longer exists.' : 'Failed to rename department.')
        return
      }
      setEditId(null)
      setEditName('')
      toast.success('Department renamed.')
      void load()
    } catch {
      toast.error('Failed to rename department.')
    } finally {
      setSavingEdit(false)
    }
  }

  return (
    <div className="admin-section">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Building2 size={16} style={{ color: 'var(--aae-accent, var(--aae-link))' }} />
        <h3 style={{ margin: 0 }}>Departments</h3>
        <div style={{ flex: 1 }} />
        <button type="button" className="ghost-button" onClick={() => void load()} style={{ fontSize: 13 }}>
          <RefreshCw size={12} style={{ marginRight: 4 }} /> Refresh
        </button>
        <button
          type="button"
          className="primary-button"
          style={{ padding: '5px 14px', fontSize: 13 }}
          onClick={() => setCreateOpen(o => !o)}
        >
          <Plus size={13} style={{ marginRight: 4 }} /> New Department
        </button>
      </div>

      <p className="mm-editor-hint" style={{ marginBottom: 12 }}>
        Manage organizational departments for Advanced ID Asia Engineering. Members can be assigned to departments for directory grouping and access control.
      </p>

      {/* Create form */}
      {createOpen && (
        <div style={{
          padding: 14, marginBottom: 14,
          border: '1px solid var(--mm-border-subtle)',
          borderRadius: 8, background: 'var(--bg)'
        }}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
            <input
              className="slack-input"
              placeholder="Department name (e.g. Engineering)"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              style={{ flex: 2, minWidth: 180 }}
              autoFocus
            />
            <input
              className="slack-input"
              placeholder="Code (optional, e.g. ENG)"
              value={newCode}
              onChange={e => setNewCode(e.target.value)}
              style={{ flex: 1, minWidth: 100 }}
            />
          </div>
          {createError && <p className="form-error" style={{ marginBottom: 8 }}>{createError}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="primary-button" onClick={() => void handleCreate()} disabled={creating} style={{ fontSize: 13, padding: '5px 16px' }}>
              {creating ? 'Creating…' : 'Create'}
            </button>
            <button type="button" className="ghost-button" onClick={() => { setCreateOpen(false); setCreateError('') }} style={{ fontSize: 13 }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="form-error">{error}</p>}

      <table className="admin-table">
        <thead>
          <tr>
            <th>Department</th>
            <th>Code</th>
            <th style={{ textAlign: 'center' }}>Members</th>
            <th>Created</th>
            <th style={{ width: 110 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={5} style={{ textAlign: 'center', padding: 16 }}>Loading…</td></tr>
          ) : departments.length === 0 ? (
            <tr><td colSpan={5} style={{ textAlign: 'center', padding: 16, color: 'var(--mm-muted)' }}>No departments created yet.</td></tr>
          ) : (
            departments.map(d => (
              <DepartmentRow
                key={d.id}
                dep={d}
                editing={editId === d.id}
                editName={editName}
                savingEdit={savingEdit}
                confirmingDelete={confirmDeleteId === d.id}
                deleting={deletingId === d.id}
                onEditNameChange={setEditName}
                onStartEdit={() => startEdit(d)}
                onSaveEdit={() => void handleSaveEdit(d.id)}
                onCancelEdit={() => { setEditId(null); setEditName('') }}
                onAskDelete={() => setConfirmDeleteId(d.id)}
                onConfirmDelete={() => void handleDelete(d.id)}
                onCancelDelete={() => setConfirmDeleteId(null)}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
