'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { UserPlus, UserMinus, Users, Loader2, X, Hash, AlertCircle, Mail, Clock } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import { toast } from '@/lib/ui/toast'

/* ── Guest Account Management — invite, list & revoke external collaborators ── */

interface GuestRow {
  id: string
  user_id: string
  email: string
  username: string
  first_name?: string | null
  last_name?: string | null
  invited_by_username?: string | null
  expires_at: number
  created_at: number
  channel_ids: string[] | null
}

interface ChannelRow {
  id: string
  name: string
  display_name: string
  type: string
}

interface AdminUser {
  id: string
  email: string
  username: string
}

const ERROR_MESSAGES: Record<string, string> = {
  workspace_id_required: 'No workspace selected.',
  user_id_required: 'Select a user to invite.',
  channel_ids_required: 'Pick at least one channel.',
  forbidden: 'You do not have permission to manage guests.',
  guest_not_found: 'Guest account no longer exists.',
  db_unavailable: 'Database is unavailable. Try again shortly.',
}

function fullName(g: { first_name?: string | null; last_name?: string | null; username: string }): string {
  return [g.first_name, g.last_name].filter(Boolean).join(' ') || g.username
}

function relativeDate(ts: number): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function expiryLabel(ts: number): { text: string; expired: boolean } {
  if (!ts) return { text: 'No expiry', expired: false }
  return { text: relativeDate(ts), expired: ts < Date.now() }
}

function errorText(code: string | undefined): string {
  return ERROR_MESSAGES[code || ''] || 'Something went wrong. Try again.'
}

const S = {
  field: { display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--mm-border)', borderRadius: 8, padding: '8px 10px' } as const,
  input: { flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--mm-text)', fontSize: 14 } as const,
  label: { display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6 } as const,
  primaryBtn: { display: 'flex', alignItems: 'center', gap: 6, background: 'linear-gradient(135deg, #06b6d4, #0891b2)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' } as const,
  dangerBtn: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, background: '#e01e5a20', color: '#e01e5a', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' } as const,
  card: { padding: 14, borderRadius: 12, border: '1px solid var(--mm-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 } as const,
  badge: (c: string) => ({ fontSize: 10, padding: '1px 6px', borderRadius: 6, background: `${c}20`, color: c, fontWeight: 700 } as const),
}

/* ── Single guest row with revoke action ── */
function GuestCard({ g, busy, onRevoke }: { g: GuestRow; busy: boolean; onRevoke: () => void }) {
  const exp = expiryLabel(g.expires_at)
  const channelCount = (g.channel_ids || []).length
  return (
    <div style={S.card}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
          {fullName(g)}{exp.expired && <span style={S.badge('#e01e5a')}>EXPIRED</span>}
        </div>
        <div style={{ fontSize: 12, opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.email || g.username}</div>
        <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span><Hash size={10} style={{ verticalAlign: -1 }} /> {channelCount} channel{channelCount !== 1 ? 's' : ''}</span>
          <span>By {g.invited_by_username || 'admin'}</span>
          <span>Added {relativeDate(g.created_at)}</span>
          <span>Expires {exp.text}</span>
        </div>
      </div>
      <button type="button" title="Revoke guest access" disabled={busy} onClick={onRevoke} style={S.dangerBtn}>
        {busy ? <Loader2 size={14} className="spin" /> : <UserMinus size={14} />} Revoke
      </button>
    </div>
  )
}

/* ── Invite modal: per-channel checklist + expiry ── */
function GuestInviteModal({ workspaceId, channels, onClose, onInvited }: {
  workspaceId: string
  channels: ChannelRow[]
  onClose: () => void
  onInvited: () => void
}) {
  const [email, setEmail] = useState('')
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [expiryDays, setExpiryDays] = useState('30')
  const [busy, setBusy] = useState(false)

  const toggle = (id: string) => setSelected(prev => ({ ...prev, [id]: !prev[id] }))
  const chosen = useMemo(() => channels.filter(c => selected[c.id]).map(c => c.id), [channels, selected])

  async function submit() {
    const addr = email.trim().toLowerCase()
    if (!addr.includes('@')) { toast.error('Enter a valid email address.'); return }
    if (chosen.length === 0) { toast.error('Pick at least one channel.'); return }
    setBusy(true)
    try {
      // The invite endpoint takes a resolved user_id; look the invitee up by email.
      const uRes = await apiFetch('/api/admin/users')
      if (!uRes.ok) { toast.error('Could not look up the user.'); return }
      const uData = (await uRes.json()) as { users?: AdminUser[] }
      const match = (uData.users || []).find(u => (u.email || '').toLowerCase() === addr)
      if (!match) { toast.error('No user with that email exists yet. Create the account first.'); return }

      const days = Math.max(0, parseInt(expiryDays, 10) || 0)
      const expiresAt = days > 0 ? Date.now() + days * 86_400_000 : 0
      const res = await apiFetch('/api/admin/guests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, user_id: match.id, channel_ids: chosen, expires_at: expiresAt }),
      })
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(errorText(d.error))
        return
      }
      toast.success(`Invited ${match.username} as a guest.`)
      onInvited()
      onClose()
    } catch {
      toast.error('Could not send the invite.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'grid', placeItems: 'center', zIndex: 1000 }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 'min(520px, 92vw)', maxHeight: '86vh', display: 'flex', flexDirection: 'column',
        background: 'var(--mm-main-bg)', color: 'var(--mm-text)', borderRadius: 14, border: '1px solid var(--mm-border)',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--mm-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Invite Guest</h3>
          <button onClick={onClose} className="mm-icon-btn" title="Close" style={{ color: 'var(--mm-muted)' }}><X size={18} /></button>
        </div>
        <div style={{ padding: 20, overflowY: 'auto' }}>
          <label style={S.label}>Guest email</label>
          <div style={{ ...S.field, marginBottom: 16 }}>
            <Mail size={15} style={{ opacity: 0.5, flexShrink: 0 }} />
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="guest@partner.com" style={S.input} />
          </div>

          <label style={S.label}>Channel access</label>
          <div style={{ border: '1px solid var(--mm-border)', borderRadius: 8, maxHeight: 220, overflowY: 'auto', marginBottom: 16 }}>
            {channels.length === 0 ? (
              <p style={{ padding: 14, margin: 0, fontSize: 13, color: 'var(--mm-muted)', textAlign: 'center' }}>No channels available.</p>
            ) : channels.map(c => (
              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', cursor: 'pointer', borderBottom: '1px solid var(--mm-border)' }}>
                <input type="checkbox" checked={!!selected[c.id]} onChange={() => toggle(c.id)} />
                <Hash size={14} style={{ opacity: 0.5 }} />
                <span style={{ fontSize: 14 }}>{c.display_name || c.name}</span>
              </label>
            ))}
          </div>

          <label style={S.label}>Access expires in (days, 0 = never)</label>
          <div style={S.field}>
            <Clock size={15} style={{ opacity: 0.5, flexShrink: 0 }} />
            <input value={expiryDays} onChange={e => setExpiryDays(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="30" style={S.input} />
          </div>
        </div>
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--mm-border)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} disabled={busy}
            style={{ background: 'none', border: '1px solid var(--mm-border)', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: 'var(--mm-text)' }}>Cancel</button>
          <button onClick={() => void submit()} disabled={busy} style={S.primaryBtn}>
            {busy ? <Loader2 size={14} className="spin" /> : <UserPlus size={14} />} Send Invite
          </button>
        </div>
      </div>
    </div>
  )
}

export default function GuestManagementPanel({ onClose }: { onClose: () => void }) {
  const [workspaceId, setWorkspaceId] = useState('')
  const [guests, setGuests] = useState<GuestRow[]>([])
  const [channels, setChannels] = useState<ChannelRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revoking, setRevoking] = useState<string | null>(null)
  const [showInvite, setShowInvite] = useState(false)

  // Resolve the active workspace: prefer the persisted selection, else the first
  // workspace the admin belongs to.
  const resolveWorkspace = useCallback(async (): Promise<string> => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem('aaelink_workspace_id') : null
    if (stored) return stored
    const res = await apiFetch('/api/workspaces')
    if (res.ok) {
      const d = (await res.json()) as { workspaces?: { id: string }[] }
      return d.workspaces?.[0]?.id || ''
    }
    return ''
  }, [])

  const load = useCallback(async (wsId: string) => {
    if (!wsId) { setLoading(false); setError('No workspace selected.'); return }
    setLoading(true)
    setError('')
    try {
      const [gRes, cRes] = await Promise.all([
        apiFetch(`/api/admin/guests?workspace_id=${encodeURIComponent(wsId)}`),
        apiFetch(`/api/channels?workspace_id=${encodeURIComponent(wsId)}`),
      ])
      if (!gRes.ok) {
        const d = (await gRes.json().catch(() => ({}))) as { error?: string }
        setError(errorText(d.error))
        return
      }
      const gData = (await gRes.json()) as { guests?: GuestRow[] }
      setGuests(gData.guests || [])
      if (cRes.ok) {
        const cData = (await cRes.json()) as { channels?: ChannelRow[] }
        // Guests are invited to standard channels only (exclude DMs/group DMs).
        setChannels((cData.channels || []).filter(c => c.type === 'O' || c.type === 'P'))
      }
    } catch {
      setError('Could not load guest accounts.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void (async () => {
      const wsId = await resolveWorkspace()
      setWorkspaceId(wsId)
      await load(wsId)
    })()
  }, [resolveWorkspace, load])

  async function revoke(g: GuestRow) {
    setRevoking(g.id)
    try {
      const res = await apiFetch('/api/admin/guests', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guest_id: g.id, workspace_id: workspaceId }),
      })
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(errorText(d.error))
        return
      }
      toast.success(`Revoked ${fullName(g)}'s guest access.`)
      setGuests(prev => prev.filter(x => x.id !== g.id))
    } catch {
      toast.error('Could not revoke access.')
    } finally {
      setRevoking(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--mm-main-bg)', color: 'var(--mm-text)' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--mm-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #06b6d4, #0891b2)', display: 'grid', placeItems: 'center' }}><Users size={18} color="#fff" /></div>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Guest Accounts</h2>
            <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>{guests.length} external collaborator{guests.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowInvite(true)} disabled={!workspaceId}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#06b6d420', color: '#0891b2', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: workspaceId ? 'pointer' : 'not-allowed' }}>
            <UserPlus size={14} /> Invite Guest
          </button>
          <button onClick={onClose} className="mm-icon-btn" title="Close" style={{ color: 'var(--mm-muted)' }}><X size={18} /></button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--mm-muted)' }}>
            <Loader2 size={20} className="spin" /> Loading guests…
          </div>
        ) : error ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', padding: 24, color: '#e01e5a', fontSize: 13 }}>
            <AlertCircle size={16} /> {error}
          </div>
        ) : guests.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 32, color: 'var(--mm-muted)' }}>
            <Users size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>No guest accounts yet</p>
            <p style={{ margin: '4px 0 0', fontSize: 12 }}>Invite an external collaborator to specific channels.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {guests.map(g => (
              <GuestCard key={g.id} g={g} busy={revoking === g.id} onRevoke={() => void revoke(g)} />
            ))}
          </div>
        )}
      </div>

      {showInvite && (
        <GuestInviteModal workspaceId={workspaceId} channels={channels}
          onClose={() => setShowInvite(false)} onInvited={() => void load(workspaceId)} />
      )}
    </div>
  )
}
