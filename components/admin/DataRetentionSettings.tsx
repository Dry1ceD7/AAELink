'use client'

import { useCallback, useEffect, useState } from 'react'
import { FolderCog, AlertTriangle, X, Loader2, Trash2 } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import { toast } from '@/lib/ui/toast'
import { useConfirm } from '@/components/a11y'

/* ─────────────────────────────────────────────────────────────────────
   DataRetentionSettings — Enterprise compliance controls
   • Global & per-channel retention policies (loaded from API)
   • Auto-delete messages/files after N days
   • Legal holds always take precedence over retention policies
   ───────────────────────────────────────────────────────────────────── */

interface RetentionPolicy {
  id: string
  workspace_id: string
  scope: 'global' | 'channel' | 'dm'
  name: string
  message_days: number | null
  file_days: number | null
  channel_id?: string
  is_active: boolean
}

const DAY_OPTIONS = [
  { value: 'forever', label: 'Keep forever' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '180', label: '180 days' },
  { value: '365', label: '1 year' },
  { value: '730', label: '2 years' },
]

const SELECT_STYLE: React.CSSProperties = {
  width: '100%', border: '1px solid var(--mm-border)', borderRadius: 8,
  padding: '8px 10px', fontSize: 13, background: 'var(--mm-main-bg)',
  color: 'var(--mm-text)', cursor: 'pointer',
}

export default function DataRetentionSettings({ onClose }: { onClose: () => void }) {
  const { confirm, confirmDialog } = useConfirm()
  const [workspaceId, setWorkspaceId] = useState('')
  const [policies, setPolicies] = useState<RetentionPolicy[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  // Resolve the active workspace once.
  useEffect(() => {
    void (async () => {
      try {
        const res = await apiFetch('/api/workspaces')
        if (res.ok) {
          const data = (await res.json()) as { teams?: { id: string }[] }
          const ws = data.teams || []
          if (ws.length) setWorkspaceId(ws[0].id)
        }
      } catch { /* handled by the load effect's error state */ }
    })()
  }, [])

  const load = useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch(`/api/admin/retention-policies?workspace_id=${encodeURIComponent(workspaceId)}`)
      if (!res.ok) {
        const msg = res.status === 403 ? 'You do not have permission to view retention policies.' : 'Failed to load retention policies.'
        setError(msg)
        toast.error(msg)
        return
      }
      const data = (await res.json()) as { policies?: RetentionPolicy[] }
      setPolicies(data.policies || [])
    } catch {
      setError('Failed to load retention policies.')
      toast.error('Failed to load retention policies.')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => { void load() }, [load])

  const persist = async (id: string, updates: Partial<RetentionPolicy>) => {
    const prev = policies
    setPolicies(p => p.map(x => x.id === id ? { ...x, ...updates } : x))
    try {
      const res = await apiFetch('/api/admin/retention-policies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          policy_id: id,
          message_days: updates.message_days,
          file_days: updates.file_days,
          is_active: updates.is_active,
        }),
      })
      if (!res.ok) throw new Error('patch_failed')
      toast.success('Retention policy updated.')
    } catch {
      setPolicies(prev)
      toast.error('Could not update retention policy.')
    }
  }

  const createPolicy = async () => {
    const name = newName.trim()
    if (!name || !workspaceId) return
    try {
      const res = await apiFetch('/api/admin/retention-policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, scope: 'channel', name, message_days: 90, file_days: 90 }),
      })
      if (!res.ok) throw new Error('create_failed')
      setCreating(false)
      setNewName('')
      toast.success('Retention policy created.')
      void load()
    } catch {
      toast.error('Could not create retention policy.')
    }
  }

  const deletePolicy = async (p: RetentionPolicy) => {
    if (!(await confirm({ title: 'Delete policy', message: `Delete the "${p.name}" retention policy?`, danger: true, confirmLabel: 'Delete' }))) return
    try {
      const res = await apiFetch(`/api/admin/retention-policies?policy_id=${encodeURIComponent(p.id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('delete_failed')
      setPolicies(prev => prev.filter(x => x.id !== p.id))
      toast.success('Retention policy deleted.')
    } catch {
      toast.error('Could not delete retention policy.')
    }
  }

  const daysValue = (n: number | null) => (n == null ? 'forever' : String(n))
  const parseDays = (v: string): number | null => (v === 'forever' ? null : parseInt(v, 10))

  return (
    <>
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--mm-main-bg)', color: 'var(--mm-text)',
      animation: 'slack-slide-up 200ms var(--slack-ease-out) forwards',
    }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--mm-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FolderCog size={18} />
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Data Retention Policies</h2>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}><X size={18} /></button>
        </div>
        <p style={{ fontSize: 13, opacity: 0.6, margin: '8px 0 0', lineHeight: 1.5 }}>
          Control how long messages and files are retained. Policies override defaults on a per-channel basis.
          Legal holds take precedence over all retention policies.
        </p>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        <div style={{
          background: 'rgba(232,168,32,0.08)', border: '1px solid rgba(232,168,32,0.2)',
          borderRadius: 12, padding: 14, marginBottom: 20,
          display: 'flex', gap: 10, fontSize: 13, lineHeight: 1.5,
        }}>
          <span style={{ display: 'flex', flexShrink: 0 }}><AlertTriangle size={16} style={{ color: '#e8a820' }} /></span>
          <div>
            <strong>Caution:</strong> Reducing retention periods will permanently delete messages and files
            older than the new threshold. This action cannot be undone. Ensure legal holds are in place
            before modifying policies.
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--mm-muted)' }}><Loader2 size={20} className="spin" /> Loading policies…</div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: 24, color: '#e01e5a', fontSize: 13 }}>{error}</div>
        ) : policies.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--mm-muted)', fontSize: 13 }}>No retention policies yet.</div>
        ) : policies.map(policy => (
          <div key={policy.id} style={{
            border: '1px solid var(--mm-border)', borderRadius: 12,
            padding: 16, marginBottom: 12, background: 'var(--mm-rhs-bg)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 6,
                  background: policy.scope === 'global' ? 'rgba(67,97,238,0.12)' : policy.scope === 'channel' ? 'rgba(43,172,118,0.12)' : 'rgba(232,168,32,0.12)',
                  color: policy.scope === 'global' ? '#4361EE' : policy.scope === 'channel' ? '#2bac76' : '#e8a820',
                  fontWeight: 600, textTransform: 'uppercase',
                }}>{policy.scope}</span>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{policy.name}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button onClick={() => setEditingId(editingId === policy.id ? null : policy.id)} style={{
                  background: 'none', border: '1px solid var(--mm-border)',
                  borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer', color: 'var(--mm-muted)',
                }}>Edit</button>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={policy.is_active}
                    onChange={() => void persist(policy.id, { is_active: !policy.is_active })}
                    style={{ accentColor: '#4361EE' }} />
                  <span style={{ fontSize: 12 }}>Active</span>
                </label>
                <button onClick={() => void deletePolicy(policy)} aria-label="Delete policy" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e01e5a', display: 'flex' }}><Trash2 size={15} /></button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ fontSize: 13 }}>
                <span style={{ opacity: 0.5 }}>Messages: </span>
                <span style={{ fontWeight: 600 }}>{policy.message_days === null ? 'Keep forever' : `${policy.message_days} days`}</span>
              </div>
              <div style={{ fontSize: 13 }}>
                <span style={{ opacity: 0.5 }}>Files: </span>
                <span style={{ fontWeight: 600 }}>{policy.file_days === null ? 'Keep forever' : `${policy.file_days} days`}</span>
              </div>
            </div>

            {editingId === policy.id && (
              <div style={{
                marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--mm-border)',
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
              }}>
                <div>
                  <label style={{ fontSize: 12, opacity: 0.6, display: 'block', marginBottom: 4 }}>Message retention (days)</label>
                  <select value={daysValue(policy.message_days)} style={SELECT_STYLE}
                    onChange={e => void persist(policy.id, { message_days: parseDays(e.target.value) })}>
                    {DAY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, opacity: 0.6, display: 'block', marginBottom: 4 }}>File retention (days)</label>
                  <select value={daysValue(policy.file_days)} style={SELECT_STYLE}
                    onChange={e => void persist(policy.id, { file_days: parseDays(e.target.value) })}>
                    {DAY_OPTIONS.filter(o => o.value !== '730').map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>
        ))}

        {creating ? (
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Policy name (e.g. #finance)" autoFocus
              style={{ flex: 1, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13, outline: 'none' }} />
            <button onClick={() => void createPolicy()} style={{ background: '#4361EE', color: '#fff', border: 'none', borderRadius: 8, padding: '0 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Create</button>
            <button onClick={() => { setCreating(false); setNewName('') }} style={{ background: 'var(--mm-hover-bg)', color: 'var(--mm-text)', border: 'none', borderRadius: 8, padding: '0 14px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          </div>
        ) : (
          <button onClick={() => setCreating(true)} disabled={!workspaceId} style={{
            width: '100%', padding: '12px', borderRadius: 12,
            border: '1px dashed var(--mm-border)', background: 'none',
            cursor: workspaceId ? 'pointer' : 'not-allowed', color: 'var(--mm-muted)', fontSize: 13, opacity: workspaceId ? 1 : 0.5,
          }}>
            + Add channel-specific policy
          </button>
        )}
      </div>
    </div>
    {confirmDialog}
    </>
  )
}
