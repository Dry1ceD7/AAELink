'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/apiClient'
import { Users, Search, X, Plus, ToggleLeft, ToggleRight, ChevronDown, ChevronRight, Edit, Trash2, Hash, User, Loader2 } from 'lucide-react'

/* ── User Groups — Wired to /api/admin/user-groups ──────────────── */

interface UserGroup {
  id: string
  handle: string
  name: string
  description: string
  member_count: number
  enabled: boolean
  created_by_username?: string
  created_at: string
}

export default function UserGroupsPanel({ onClose }: { onClose: () => void }) {
  const [groups, setGroups] = useState<UserGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Create form state
  const [newHandle, setNewHandle] = useState('')
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [creating, setCreating] = useState(false)

  const loadGroups = useCallback(async () => {
    try {
      setLoading(true)
      const res = await apiFetch('/api/admin/user-groups')
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      setGroups(data.groups || [])
    } catch {
      setGroups([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadGroups() }, [loadGroups])

  const toggleGroup = useCallback(async (id: string, enabled: boolean) => {
    setGroups(prev => prev.map(g => g.id === id ? { ...g, enabled: !enabled } : g))
    await apiFetch('/api/admin/user-groups', {
      method: 'PATCH', body: JSON.stringify({ id, enabled: !enabled }),
    }).catch(() => {})
  }, [])

  const deleteGroup = useCallback(async (id: string) => {
    if (!confirm('Delete this user group?')) return
    setGroups(prev => prev.filter(g => g.id !== id))
    await apiFetch(`/api/admin/user-groups?id=${id}`, { method: 'DELETE' }).catch(() => {})
  }, [])

  const createGroup = useCallback(async () => {
    if (!newHandle.trim() || !newName.trim()) return
    setCreating(true)
    try {
      const res = await apiFetch('/api/admin/user-groups', {
        method: 'POST',
        body: JSON.stringify({
          handle: newHandle.trim(),
          name: newName.trim(),
          description: newDescription.trim(),
        }),
      })
      if (res.ok) {
        setShowCreate(false)
        setNewHandle('')
        setNewName('')
        setNewDescription('')
        loadGroups()
      }
    } finally {
      setCreating(false)
    }
  }, [newHandle, newName, newDescription, loadGroups])

  const filtered = groups.filter(g =>
    g.handle.toLowerCase().includes(search.toLowerCase()) ||
    g.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--mm-main-bg)', color: 'var(--mm-text)' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--mm-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #ec4899, #db2777)', display: 'grid', placeItems: 'center' }}>
              <Users size={18} color="#fff" />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>User Groups</h2>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>Manage @mention groups for your workspace</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowCreate(true)} style={{
              background: 'linear-gradient(135deg, #ec4899, #db2777)', color: '#fff', border: 'none',
              borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 4,
            }}><Plus size={14} /> Create Group</button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}>
              <X size={18} />
            </button>
          </div>
        </div>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search groups…"
            style={{ width: '100%', padding: '9px 14px 9px 32px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, opacity: 0.5 }}>
            <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 13, marginTop: 8 }}>Loading groups…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, opacity: 0.5 }}>
            <Users size={36} />
            <span style={{ fontSize: 14, fontWeight: 600, marginTop: 8 }}>{search ? 'No groups found' : 'No user groups yet'}</span>
            <span style={{ fontSize: 12, marginTop: 4 }}>Create a group to mention multiple people at once</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(group => {
              const expanded = expandedGroup === group.id
              return (
                <div key={group.id} style={{ borderRadius: 12, border: '1px solid var(--mm-border)', overflow: 'hidden', opacity: group.enabled ? 1 : 0.6 }}>
                  <div onClick={() => setExpandedGroup(expanded ? null : group.id)} style={{
                    padding: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    transition: 'background 100ms ease',
                  }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--mm-hover-bg)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <code style={{ fontWeight: 700, fontSize: 14, color: '#ec4899' }}>@{group.handle}</code>
                        <span style={{ fontSize: 13, opacity: 0.7 }}>{group.name}</span>
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.5, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <User size={11} /> {group.member_count || 0} member{group.member_count !== 1 ? 's' : ''}
                        {group.description && <> · {group.description}</>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} onClick={e => e.stopPropagation()}>
                      <button onClick={() => toggleGroup(group.id, group.enabled)} style={{
                        background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: group.enabled ? '#2bac76' : 'var(--mm-muted)',
                      }}>
                        {group.enabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                      </button>
                      {expanded ? <ChevronDown size={16} style={{ opacity: 0.4 }} /> : <ChevronRight size={16} style={{ opacity: 0.4 }} />}
                    </div>
                  </div>

                  {expanded && (
                    <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--mm-border)', fontSize: 13 }}>
                      <div style={{ marginTop: 12 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>Details</div>
                        <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>
                          Created by: {group.created_by_username || 'unknown'} · {new Date(group.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                        <button style={{
                          background: '#4361EE', color: '#fff', border: 'none', borderRadius: 8,
                          padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontWeight: 600,
                          display: 'flex', alignItems: 'center', gap: 4,
                        }}><Edit size={12} /> Edit Members</button>
                        <button onClick={() => deleteGroup(group.id)} style={{
                          background: '#e01e5a20', color: '#e01e5a', border: 'none', borderRadius: 8,
                          padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontWeight: 600,
                          display: 'flex', alignItems: 'center', gap: 4,
                        }}><Trash2 size={12} /> Delete Group</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 3000, display: 'grid', placeItems: 'center', animation: 'slack-modal-in 200ms var(--slack-ease-bounce) forwards' }} onClick={() => setShowCreate(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--mm-main-bg)', borderRadius: 16, padding: 24, width: 440, boxShadow: 'var(--slack-shadow-modal)' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 800 }}>Create User Group</h3>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>Handle</label>
              <input value={newHandle} onChange={e => setNewHandle(e.target.value)} placeholder="team-name" style={{
                width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--mm-border)',
                background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
              }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>Display Name</label>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g., Engineering Team" style={{
                width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--mm-border)',
                background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
              }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>Description</label>
              <input value={newDescription} onChange={e => setNewDescription(e.target.value)} placeholder="What is this group for?" style={{
                width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--mm-border)',
                background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
              }} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowCreate(false)} style={{ background: 'var(--mm-hover-bg)', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', color: 'var(--mm-text)', fontSize: 13 }}>Cancel</button>
              <button onClick={createGroup} disabled={creating || !newHandle.trim() || !newName.trim()} style={{
                background: '#ec4899', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px',
                fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: creating ? 0.6 : 1,
              }}>{creating ? 'Creating…' : 'Create Group'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
