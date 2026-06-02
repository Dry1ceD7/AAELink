'use client'

import { useCallback, useEffect, useState } from 'react'
import { Building2, Plus, RefreshCw, Users, Trash2 } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'

interface Department {
  id: string
  workspace_id: string
  code: string
  name: string
  member_count: number
  created_at: number
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

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/api/admin/departments')
      if (!res.ok) {
        setError('Failed to load departments.')
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
        const data = await res.json()
        setCreateError(data.error === 'department_already_exists' ? 'A department with this code already exists.' : data.error || 'Failed to create.')
        return
      }
      setNewName('')
      setNewCode('')
      setCreateOpen(false)
      void load()
    } catch {
      setCreateError('Network error.')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    setConfirmDeleteId(null)
    await apiFetch(`/api/admin/departments?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    void load()
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
            <th style={{ width: 80 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={5} style={{ textAlign: 'center', padding: 16 }}>Loading…</td></tr>
          ) : departments.length === 0 ? (
            <tr><td colSpan={5} style={{ textAlign: 'center', padding: 16, color: 'var(--mm-muted)' }}>No departments created yet.</td></tr>
          ) : (
            departments.map(d => (
              <tr key={d.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Building2 size={14} style={{ color: 'var(--mm-muted)', flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{d.name}</span>
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
                  {confirmDeleteId === d.id ? (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button type="button" className="ghost-button" style={{ color: 'var(--mm-danger)', fontSize: 12 }}
                        onClick={() => void handleDelete(d.id)}>Confirm</button>
                      <button type="button" className="ghost-button" style={{ fontSize: 12 }}
                        onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                    </div>
                  ) : (
                    <button type="button" className="ghost-button" style={{ color: 'var(--mm-danger)', fontSize: 12 }}
                      onClick={() => setConfirmDeleteId(d.id)} title="Delete department">
                      <Trash2 size={13} />
                    </button>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
