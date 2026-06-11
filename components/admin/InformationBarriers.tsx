'use client'

import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck, MessageCircle, Megaphone, FolderOpen, Search, Ban, X, Loader2, Trash2 } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import { toast } from '@/lib/ui/toast'
import { useConfirm } from '@/components/a11y'

/* ─────────────────────────────────────────────────────────────────────
   InformationBarriers — Enterprise compliance walls
   • Prevent specific groups from communicating
   • Block DMs, channels, search, and file sharing between groups
   • Loaded live from /api/compliance/barriers
   ───────────────────────────────────────────────────────────────────── */

interface BarrierRow {
  id: string
  name: string
  group_a_ids?: string[]
  group_b_ids?: string[]
  block_dm?: boolean
  block_channels?: boolean
  block_search?: boolean
  block_file_share?: boolean
  is_active?: boolean
  created_by_username?: string
  created_at?: number
}

type ActionKey = 'dm' | 'channel' | 'search' | 'file'

const ACTION_LABELS: Record<ActionKey, { label: string; Icon: React.ComponentType<{ size: number }> }> = {
  dm: { label: 'Direct Messages', Icon: MessageCircle },
  channel: { label: 'Shared Channels', Icon: Megaphone },
  search: { label: 'User Search', Icon: Search },
  file: { label: 'File Sharing', Icon: FolderOpen },
}

function blockedActions(b: BarrierRow): ActionKey[] {
  const out: ActionKey[] = []
  if (b.block_dm) out.push('dm')
  if (b.block_channels) out.push('channel')
  if (b.block_search) out.push('search')
  if (b.block_file_share) out.push('file')
  return out
}

function groupCount(ids: string[] | undefined): number {
  return Array.isArray(ids) ? ids.length : 0
}

export default function InformationBarriers({ onClose }: { onClose: () => void }) {
  const { confirm, confirmDialog } = useConfirm()
  const [barriers, setBarriers] = useState<BarrierRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/api/compliance/barriers')
      if (!res.ok) {
        const code = res.status === 403 ? 'You do not have permission to view information barriers.' : 'Failed to load information barriers.'
        setError(code)
        toast.error(code)
        return
      }
      const data = (await res.json()) as { barriers?: BarrierRow[] }
      setBarriers(data.barriers || [])
    } catch {
      setError('Failed to load information barriers.')
      toast.error('Failed to load information barriers.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const toggleBarrier = async (b: BarrierRow) => {
    const next = !b.is_active
    setBarriers(prev => prev.map(x => x.id === b.id ? { ...x, is_active: next } : x))
    try {
      const res = await apiFetch(`/api/compliance/barriers?barrier_id=${encodeURIComponent(b.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: next }),
      })
      if (!res.ok) throw new Error('toggle_failed')
      toast.success(next ? 'Barrier enabled.' : 'Barrier disabled.')
    } catch {
      setBarriers(prev => prev.map(x => x.id === b.id ? { ...x, is_active: !next } : x))
      toast.error('Could not update barrier.')
    }
  }

  const deleteBarrier = async (b: BarrierRow) => {
    if (!(await confirm({ title: 'Delete barrier', message: `Delete the "${b.name}" barrier? This removes the compliance wall.`, danger: true, confirmLabel: 'Delete' }))) return
    try {
      const res = await apiFetch(`/api/compliance/barriers?barrier_id=${encodeURIComponent(b.id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('delete_failed')
      setBarriers(prev => prev.filter(x => x.id !== b.id))
      toast.success('Barrier deleted.')
    } catch {
      toast.error('Could not delete barrier.')
    }
  }

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
            <ShieldCheck size={18} />
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Information Barriers</h2>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}><X size={18} /></button>
        </div>
        <p style={{ fontSize: 13, opacity: 0.6, margin: '8px 0 0', lineHeight: 1.5 }}>
          Information barriers restrict communication between groups to meet regulatory requirements (FINRA, SEC, GDPR).
          Blocked actions are enforced at the API level and cannot be circumvented by users.
        </p>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--mm-muted)' }}><Loader2 size={20} className="spin" /> Loading barriers…</div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: 24, color: '#e01e5a', fontSize: 13 }}>{error}</div>
        ) : barriers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--mm-muted)', fontSize: 13 }}>No information barriers configured.</div>
        ) : barriers.map(barrier => {
          const actions = blockedActions(barrier)
          return (
          <div key={barrier.id} style={{
            border: '1px solid var(--mm-border)', borderRadius: 12,
            padding: 16, marginBottom: 14, background: 'var(--mm-rhs-bg)',
            opacity: barrier.is_active ? 1 : 0.6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>{barrier.name}</div>
                <div style={{ fontSize: 12, opacity: 0.5 }}>
                  Created by {barrier.created_by_username || 'admin'}
                  {barrier.created_at ? ` · ${new Date(barrier.created_at).toLocaleDateString()}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={Boolean(barrier.is_active)}
                    onChange={() => void toggleBarrier(barrier)}
                    style={{ accentColor: '#4361EE' }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: barrier.is_active ? '#2bac76' : '#e01e5a' }}>
                    {barrier.is_active ? 'Active' : 'Disabled'}
                  </span>
                </label>
                <button onClick={() => void deleteBarrier(barrier)} aria-label="Delete barrier" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e01e5a', display: 'flex' }}><Trash2 size={15} /></button>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{ flex: 1, background: 'rgba(67,97,238,0.06)', borderRadius: 10, padding: 12, textAlign: 'center' }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>Group A</div>
                <div style={{ fontSize: 11, opacity: 0.5 }}>{groupCount(barrier.group_a_ids)} members</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <span style={{ display: 'flex' }}><Ban size={20} color="#e01e5a" /></span>
                <span style={{ fontSize: 10, opacity: 0.4 }}>BLOCKED</span>
              </div>
              <div style={{ flex: 1, background: 'rgba(224,30,90,0.06)', borderRadius: 10, padding: 12, textAlign: 'center' }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>Group B</div>
                <div style={{ fontSize: 11, opacity: 0.5 }}>{groupCount(barrier.group_b_ids)} members</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {actions.map(action => {
                const cfg = ACTION_LABELS[action]
                const Icon = cfg.Icon
                return (
                  <span key={action} style={{
                    fontSize: 11, padding: '4px 10px', borderRadius: 6,
                    background: 'rgba(224,30,90,0.06)', color: '#e01e5a',
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}>
                    <Icon size={11} /> {cfg.label}
                  </span>
                )
              })}
            </div>
          </div>
          )
        })}
      </div>
    </div>
    {confirmDialog}
    </>
  )
}
