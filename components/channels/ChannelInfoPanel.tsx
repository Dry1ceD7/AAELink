'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Hash, Pin, X, Pencil, Users, Info, UserPlus, Archive, Trash2, BellOff, Bell, LogOut, Search, Lock, Unlock, Clock, Check, UserCheck } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import { MessageRichText } from '@/lib/messaging/messageRich'
import { isChannelMuted, toggleMuteChannel } from '@/lib/channels/channelMute'
import { useConfirm } from '@/components/a11y'
import { TabList } from '@/components/a11y/TabList'

interface ChannelDetail {
  id: string
  name: string
  display_name: string
  type: string
  purpose: string
  header: string
  created_at: number
  member_count: number
  pinned_count: number
}

interface PinnedMessage {
  message_id: string
  pinned_by: string
  pinned_at: number
  body: string
  author_id: string
  message_created_at: number
}

interface ChannelMember {
  user_id: string
  username: string
  first_name: string
  last_name: string
  platform_role: string
  role: string
  avatar_url?: string | null
}

interface JoinRequest {
  id: string
  channel_id: string
  user_id: string
  status: string
  created_at: number
  username: string
  first_name: string
  last_name: string
  avatar_url?: string | null
}

interface RetentionPolicy {
  scope: string
  retention_days: number
  enabled: boolean
}

interface RetentionOverride {
  channel_id: string
  retention_days: number
  enabled: boolean
}

interface Props {
  channelId: string
  onClose: () => void
  onArchived?: () => void
  onLeft?: () => void
  onMuteToggled?: (muted: boolean) => void
  currentUserId: string
}

export function ChannelInfoPanel({ channelId, onClose, onArchived, onLeft, onMuteToggled, currentUserId }: Props) {
  const { confirm, confirmDialog } = useConfirm()
  const [info, setInfo] = useState<ChannelDetail | null>(null)
  const [pins, setPins] = useState<PinnedMessage[]>([])
  const [members, setMembers] = useState<ChannelMember[]>([])
  const [tab, setTab] = useState<'about' | 'pins' | 'members'>('about')
  const [editing, setEditing] = useState<'purpose' | 'header' | null>(null)
  const [editVal, setEditVal] = useState('')
  const [saving, setSaving] = useState(false)
  const [inviteUsername, setInviteUsername] = useState('')
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteMsg, setInviteMsg] = useState('')
  const [muted, setMuted] = useState(false)
  const [memberSearch, setMemberSearch] = useState('')
  const [requests, setRequests] = useState<JoinRequest[]>([])
  const [requestBusy, setRequestBusy] = useState<string | null>(null)
  const [retentionDefault, setRetentionDefault] = useState<RetentionPolicy | null>(null)
  const [retentionOverride, setRetentionOverride] = useState<RetentionOverride | null>(null)
  const [retentionMode, setRetentionMode] = useState<'default' | 'custom'>('default')
  const [retentionDays, setRetentionDays] = useState('0')
  const [retentionSaving, setRetentionSaving] = useState(false)
  const [retentionMsg, setRetentionMsg] = useState('')

  // Current user's per-channel role + platform role, derived from the loaded
  // member list. Channel admins/owners can moderate join requests; platform
  // admins additionally manage the per-channel retention override.
  const self = useMemo(() => members.find(m => m.user_id === currentUserId), [members, currentUserId])
  const isChannelAdmin = self?.role === 'admin' || self?.role === 'owner'
  const isPlatformAdmin = self?.platform_role === 'admin' || self?.platform_role === 'owner'
  const canModerateRequests = isChannelAdmin || isPlatformAdmin

  useEffect(() => {
    setMuted(isChannelMuted(channelId))
  }, [channelId])

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/channel-info?channel_id=${encodeURIComponent(channelId)}`)
    if (res.ok) {
      const data = (await res.json()) as { channel: ChannelDetail }
      setInfo(data.channel)
    }
  }, [channelId])

  const loadPins = useCallback(async () => {
    const res = await apiFetch(`/api/pins?channel_id=${encodeURIComponent(channelId)}`)
    if (res.ok) {
      const data = (await res.json()) as { pins: PinnedMessage[] }
      setPins(data.pins)
    }
  }, [channelId])

  const loadMembers = useCallback(async () => {
    const res = await apiFetch(`/api/channel-members?channel_id=${encodeURIComponent(channelId)}`)
    if (res.ok) {
      const data = (await res.json()) as { members: ChannelMember[] }
      setMembers(data.members)
    }
  }, [channelId])

  const loadRequests = useCallback(async () => {
    const res = await apiFetch(`/api/channel-members/requests?channel_id=${encodeURIComponent(channelId)}`)
    if (res.ok) {
      const data = (await res.json()) as { requests: JoinRequest[] }
      setRequests(data.requests || [])
    } else {
      setRequests([])
    }
  }, [channelId])

  const loadRetention = useCallback(async () => {
    // Workspace-default policy (channel scope) + this channel's override, if any.
    const [defRes, ovRes] = await Promise.all([
      apiFetch('/api/admin/retention'),
      apiFetch(`/api/admin/retention/channels?channel_id=${encodeURIComponent(channelId)}`),
    ])
    if (defRes.ok) {
      const data = (await defRes.json()) as { policies: RetentionPolicy[] }
      const channelScope = data.policies?.find(p => p.scope === 'channel')
        || data.policies?.find(p => p.scope === 'workspace')
        || null
      setRetentionDefault(channelScope)
    }
    if (ovRes.ok) {
      const data = (await ovRes.json()) as { override: RetentionOverride }
      setRetentionOverride(data.override)
      setRetentionMode(data.override?.enabled ? 'custom' : 'default')
      setRetentionDays(String(data.override?.retention_days ?? 0))
    } else {
      setRetentionOverride(null)
      setRetentionMode('default')
      setRetentionDays('0')
    }
  }, [channelId])

  useEffect(() => { void load() }, [load])
  useEffect(() => { if (tab === 'pins') void loadPins() }, [tab, loadPins])
  useEffect(() => { if (tab === 'members') void loadMembers() }, [tab, loadMembers])
  useEffect(() => { if (tab === 'members' && canModerateRequests) void loadRequests() }, [tab, canModerateRequests, loadRequests])
  useEffect(() => { if (tab === 'about' && isPlatformAdmin && info?.type !== 'D' && info?.type !== 'G') void loadRetention() }, [tab, isPlatformAdmin, info?.type, loadRetention])

  async function resolveRequest(requestId: string, action: 'approve' | 'deny') {
    if (requestBusy) return
    setRequestBusy(requestId)
    const res = await apiFetch('/api/channel-members/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_id: channelId, request_id: requestId, action }),
    })
    if (res.ok) {
      setRequests(prev => prev.filter(r => r.id !== requestId))
      if (action === 'approve') { void loadMembers(); void load() }
    }
    setRequestBusy(null)
  }

  async function saveRetention() {
    if (retentionSaving) return
    setRetentionSaving(true)
    setRetentionMsg('')
    if (retentionMode === 'default') {
      // Clearing the override falls back to the workspace-default policy. A
      // missing override (404) is already the desired state.
      const res = await apiFetch(`/api/admin/retention/channels?channel_id=${encodeURIComponent(channelId)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      })
      if (res.ok || res.status === 404) {
        setRetentionMsg('Saved')
        await loadRetention()
      } else {
        const d = (await res.json().catch(() => ({}))) as { error?: string }
        setRetentionMsg(d.error || 'save_failed')
      }
    } else {
      const days = Number.parseInt(retentionDays, 10)
      if (!Number.isFinite(days) || days < 0) {
        setRetentionMsg('invalid_retention_days')
        setRetentionSaving(false)
        return
      }
      const res = await apiFetch('/api/admin/retention/channels', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: channelId, retention_days: days, enabled: true }),
      })
      if (res.ok) {
        setRetentionMsg('Saved')
        await loadRetention()
      } else {
        const d = (await res.json().catch(() => ({}))) as { error?: string }
        setRetentionMsg(d.error || 'save_failed')
      }
    }
    setRetentionSaving(false)
    setTimeout(() => setRetentionMsg(''), 2000)
  }

  async function saveField() {
    if (!editing || saving) return
    setSaving(true)
    await apiFetch('/api/channel-info', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_id: channelId, [editing]: editVal })
    })
    setSaving(false)
    setEditing(null)
    void load()
  }

  async function unpinMessage(messageId: string) {
    await apiFetch('/api/pins', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_id: channelId, message_id: messageId })
    })
    void loadPins()
  }

  return (
    <>
    <aside className="channel-info-panel">
      <header className="channel-info-header">
        <h2><Info size={16} /> Channel details</h2>
        <button type="button" className="mm-icon-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </header>

      <TabList
        ariaLabel="Channel details sections"
        idPrefix="channel-info"
        className="channel-info-tabs"
        tabs={[
          { id: 'about', label: 'About' },
          { id: 'members', label: <><Users size={13} /> Members ({info?.member_count ?? 0})</> },
          { id: 'pins', label: <><Pin size={13} /> Pinned ({info?.pinned_count ?? 0})</> },
        ]}
        value={tab}
        onChange={(id) => setTab(id as typeof tab)}
        tabClassName={(active) => `channel-info-tab${active ? ' channel-info-tab--active' : ''}`}
      />

      {tab === 'about' && info && (
        <div role="tabpanel" id="channel-info-panel-about" aria-labelledby="channel-info-tab-about" className="channel-info-body">
          <div className="channel-info-title">
            <Hash size={18} />
            <strong>{info.display_name}</strong>
          </div>

          <div className="channel-info-stat">
            <Users size={14} />
            <span>{info.member_count} member{info.member_count !== 1 ? 's' : ''}</span>
          </div>

          <div className="channel-info-stat" style={{ fontSize: 12, color: 'var(--mm-muted)' }}>
            Created {new Date(info.created_at).toLocaleDateString()}
          </div>

          {/* Purpose */}
          <div className="channel-info-field">
            <div className="channel-info-field-head">
              <span>Purpose</span>
              <button type="button" className="mm-icon-btn" title="Edit purpose"
                onClick={() => { setEditing('purpose'); setEditVal(info.purpose) }}>
                <Pencil size={13} />
              </button>
            </div>
            {editing === 'purpose' ? (
              <div className="channel-info-edit">
                <textarea rows={3} className="field-input" value={editVal}
                  onChange={e => setEditVal(e.target.value)} />
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button type="button" className="slack-button" disabled={saving}
                    onClick={() => void saveField()}>{saving ? 'Saving…' : 'Save'}</button>
                  <button type="button" className="ghost-button" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <p className="channel-info-value">{info.purpose || 'No purpose set'}</p>
            )}
          </div>

          {/* Header */}
          <div className="channel-info-field">
            <div className="channel-info-field-head">
              <span>Header</span>
              <button type="button" className="mm-icon-btn" title="Edit header"
                onClick={() => { setEditing('header'); setEditVal(info.header) }}>
                <Pencil size={13} />
              </button>
            </div>
            {editing === 'header' ? (
              <div className="channel-info-edit">
                <textarea rows={3} className="field-input" value={editVal}
                  onChange={e => setEditVal(e.target.value)} />
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button type="button" className="slack-button" disabled={saving}
                    onClick={() => void saveField()}>{saving ? 'Saving…' : 'Save'}</button>
                  <button type="button" className="ghost-button" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <p className="channel-info-value">{info.header || 'No header set'}</p>
            )}
          </div>
          {/* Mute toggle */}
          {info.type !== 'D' && (
            <div className="channel-info-field" style={{ marginTop: 12 }}>
              <button type="button" className="ghost-button"
                style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', justifyContent: 'center' }}
                onClick={async () => {
                  const next = await toggleMuteChannel(channelId)
                  setMuted(next)
                  onMuteToggled?.(next)
                }}>
                {muted ? <><Bell size={14} /> Unmute channel</> : <><BellOff size={14} /> Mute channel</>}
              </button>
            </div>
          )}
          {/* Leave channel */}
          {info.type !== 'D' && (
            <div className="channel-info-field" style={{ marginTop: 6 }}>
              <button type="button" className="ghost-button"
                style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', justifyContent: 'center', color: '#c4510d' }}
                onClick={async () => {
                  if (!(await confirm({ title: 'Leave channel', message: `Leave #${info.display_name}? You can rejoin later.`, confirmLabel: 'Leave', cancelLabel: 'Stay' }))) return
                  const res = await apiFetch(
                    `/api/channel-members?channel_id=${encodeURIComponent(channelId)}&user_id=me`,
                    { method: 'DELETE' }
                  )
                  if (res.ok) {
                    onLeft?.()
                    onClose()
                  }
                }}>
                <LogOut size={14} /> Leave channel
              </button>
            </div>
          )}
          {/* Archive button */}
          {info.type !== 'D' && (
            <div className="channel-info-field" style={{ marginTop: 6 }}>
              <button type="button" className="ghost-button ghost-button--danger"
                style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', justifyContent: 'center' }}
                onClick={async () => {
                  if (!(await confirm({ title: 'Archive channel', message: 'Are you sure you want to archive this channel?', danger: true, confirmLabel: 'Archive' }))) return
                  const res = await apiFetch('/api/channels', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ channel_id: channelId, action: 'archive' })
                  })
                  if (res.ok) {
                    onArchived?.()
                    onClose()
                  }
                }}>
                <Archive size={14} /> Archive channel
              </button>
            </div>
          )}
          {/* Convert channel type (Public ↔ Private) */}
          {(info.type === 'O' || info.type === 'P') && (
            <div className="channel-info-field" style={{ marginTop: 6 }}>
              <button type="button" className="ghost-button"
                style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', justifyContent: 'center' }}
                onClick={async () => {
                  const targetType = info.type === 'O' ? 'private' : 'public'
                  const warn = info.type === 'O'
                    ? 'Making this channel private will restrict access to invited members only. This cannot be easily undone.'
                    : 'Making this channel public will allow anyone in the workspace to join and view its history.'
                  if (!(await confirm({ title: `Convert to ${targetType}`, message: `Convert #${info.display_name} to a ${targetType} channel?\n\n${warn}`, danger: info.type === 'O', confirmLabel: 'Convert' }))) return
                  const action = info.type === 'O' ? 'convert_to_private' : 'convert_to_public'
                  const res = await apiFetch('/api/channels', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ channel_id: channelId, action })
                  })
                  if (res.ok) {
                    void load()
                  }
                }}>
                {info.type === 'O' ? <><Lock size={14} /> Convert to private channel</> : <><Unlock size={14} /> Convert to public channel</>}
              </button>
            </div>
          )}
          {/* Data retention (platform admins, non-DM channels) */}
          {isPlatformAdmin && info.type !== 'D' && info.type !== 'G' && (
            <div className="channel-info-field" style={{ marginTop: 16 }}>
              <div className="channel-info-field-head">
                <span><Clock size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Data retention</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--mm-muted)', marginBottom: 8 }}>
                {retentionDefault?.enabled
                  ? `Workspace default: keep for ${retentionDefault.retention_days} day${retentionDefault.retention_days !== 1 ? 's' : ''}.`
                  : 'Workspace default: keep messages forever.'}
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 6 }}>
                <input
                  type="radio"
                  name="retention-mode"
                  checked={retentionMode === 'default'}
                  onChange={() => setRetentionMode('default')}
                />
                Use workspace default
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 6 }}>
                <input
                  type="radio"
                  name="retention-mode"
                  checked={retentionMode === 'custom'}
                  onChange={() => setRetentionMode('custom')}
                />
                Custom for this channel
              </label>
              {retentionMode === 'custom' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '4px 0 8px 24px' }}>
                  <input
                    type="number"
                    min={0}
                    className="mm-settings-input"
                    value={retentionDays}
                    onChange={e => setRetentionDays(e.target.value)}
                    style={{ width: 80, fontSize: 13, padding: '4px 8px' }}
                  />
                  <span style={{ fontSize: 12, color: 'var(--mm-muted)' }}>days (0 = keep forever)</span>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button type="button" className="slack-button" disabled={retentionSaving}
                  style={{ padding: '6px 12px', fontSize: 12 }}
                  onClick={() => void saveRetention()}>
                  {retentionSaving ? 'Saving…' : 'Save retention'}
                </button>
                {retentionMsg && (
                  <span style={{ fontSize: 12, color: retentionMsg === 'Saved' ? '#3db265' : '#d24b4e' }}>
                    {retentionMsg === 'Saved' ? <><Check size={12} style={{ verticalAlign: 'middle' }} /> Saved</> : retentionMsg}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'pins' && (
        <div role="tabpanel" id="channel-info-panel-pins" aria-labelledby="channel-info-tab-pins" className="channel-info-body">
          {pins.length === 0 ? (
            <div className="module-empty">
              <Pin size={32} strokeWidth={1.5} />
              <h3>No pinned messages</h3>
              <p>Pin important messages so they&apos;re easy to find.</p>
            </div>
          ) : (
            <div className="pinned-list">
              {pins.map(p => (
                <div key={p.message_id} className="pinned-item">
                  <div className="pinned-item-body">
                    <MessageRichText text={p.body} />
                  </div>
                  <div className="pinned-item-meta">
                    <span>{new Date(p.message_created_at).toLocaleString()}</span>
                    <button type="button" className="link-button" style={{ fontSize: 11 }}
                      onClick={() => void unpinMessage(p.message_id)}>Unpin</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'members' && (
        <div role="tabpanel" id="channel-info-panel-members" aria-labelledby="channel-info-tab-members" className="channel-info-body">
          {/* Pending join requests (channel admins / platform admins) */}
          {canModerateRequests && requests.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--mm-muted)', marginBottom: 6 }}>
                <UserCheck size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                Pending requests ({requests.length})
              </div>
              <div className="channel-members-list">
                {requests.map(r => (
                  <div key={r.id} className="channel-member-row">
                    <div className="channel-member-avatar"
                      style={r.avatar_url ? {
                        backgroundImage: `url(${r.avatar_url})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        color: 'transparent',
                      } : undefined}
                    >
                      {(r.username || '?').slice(0, 1).toUpperCase()}
                    </div>
                    <div className="channel-member-info">
                      <span className="channel-member-name">
                        {[r.first_name, r.last_name].filter(Boolean).join(' ') || r.username}
                      </span>
                      <span className="channel-member-handle">@{r.username}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button type="button" className="slack-button" disabled={requestBusy === r.id}
                        style={{ padding: '4px 8px', fontSize: 11 }}
                        onClick={() => void resolveRequest(r.id, 'approve')}>
                        Approve
                      </button>
                      <button type="button" className="link-button" disabled={requestBusy === r.id}
                        style={{ fontSize: 11, color: '#c4510d' }}
                        onClick={() => void resolveRequest(r.id, 'deny')}>
                        Deny
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Invite input */}
          {info?.type !== 'D' && info?.type !== 'G' && (
            <div style={{ marginBottom: 12 }}>
              <form onSubmit={async (e) => {
                e.preventDefault()
                if (!inviteUsername.trim() || inviteBusy) return
                setInviteBusy(true)
                setInviteMsg('')
                // Find user by username
                const searchRes = await apiFetch(`/api/search/users?q=${encodeURIComponent(inviteUsername.trim())}`)
                let userId = ''
                if (searchRes.ok) {
                  const data = (await searchRes.json()) as { users?: Array<{ id: string; username: string }> }
                  const match = data.users?.find(u => u.username.toLowerCase() === inviteUsername.trim().toLowerCase())
                  if (match) userId = match.id
                }
                if (!userId) {
                  setInviteMsg('User not found')
                  setInviteBusy(false)
                  return
                }
                const res = await apiFetch('/api/channel-members', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ channel_id: channelId, user_id: userId })
                })
                if (res.ok) {
                  setInviteUsername('')
                  setInviteMsg('Invited!')
                  void loadMembers()
                  void load()
                  setTimeout(() => setInviteMsg(''), 2000)
                } else {
                  const d = await res.json().catch(() => ({})) as { error?: string }
                  setInviteMsg(d.error || 'Failed')
                }
                setInviteBusy(false)
              }} style={{ display: 'flex', gap: 6 }}>
              <input
                className="mm-settings-input"
                placeholder="Username to invite"
                value={inviteUsername}
                onChange={e => setInviteUsername(e.target.value)}
                style={{ flex: 1, fontSize: 13, padding: '6px 10px' }}
              />
              <button type="submit" className="slack-button" disabled={inviteBusy} style={{ padding: '6px 12px', fontSize: 12 }}>
                <UserPlus size={14} /> Add
              </button>
            </form>
            {inviteMsg && (
              <div style={{ fontSize: 12, marginTop: 4, color: inviteMsg === 'Invited!' ? '#3db265' : '#d24b4e' }}>
                {inviteMsg}
              </div>
            )}
          </div>
          )}

          {/* Member list */}
          {(() => {
            const filtered = memberSearch.trim()
              ? members.filter(m => {
                  const q = memberSearch.toLowerCase()
                  const full = `${m.first_name || ''} ${m.last_name || ''}`.trim().toLowerCase()
                  return m.username.toLowerCase().includes(q) || full.includes(q)
                })
              : members

            return (
              <>
                {/* Member search */}
                <div className="mm-forward-search" style={{ marginBottom: 8 }}>
                  <Search size={14} />
                  <input
                    type="search"
                    placeholder={`Search ${members.length} member${members.length !== 1 ? 's' : ''}…`}
                    value={memberSearch}
                    onChange={e => setMemberSearch(e.target.value)}
                    style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13 }}
                  />
                </div>

                {filtered.length === 0 ? (
                  <div className="module-empty">
                    <Users size={32} strokeWidth={1.5} />
                    <h3>{memberSearch.trim() ? 'No matching members' : 'No members'}</h3>
                  </div>
                ) : (
            <div className="channel-members-list">
              {filtered.map(m => (
                <div key={m.user_id} className="channel-member-row">
                  <div className="channel-member-avatar"
                    style={m.avatar_url ? {
                      backgroundImage: `url(${m.avatar_url})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      color: 'transparent'
                    } : undefined}
                  >
                    {(m.username || '?').slice(0, 1).toUpperCase()}
                  </div>
                  <div className="channel-member-info">
                    <span className="channel-member-name">
                      {[m.first_name, m.last_name].filter(Boolean).join(' ') || m.username}
                      {m.user_id === currentUserId && ' (you)'}
                    </span>
                    <span className="channel-member-handle">@{m.username}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="channel-member-role">{m.platform_role || m.role}</span>
                    {info?.type !== 'D' && info?.type !== 'O' && info?.type !== 'G' && m.user_id !== currentUserId && (
                      <button
                        type="button"
                        className="link-button"
                        style={{ fontSize: 11, color: '#c4510d' }}
                        title="Remove member"
                        onClick={async () => {
                          if (!(await confirm({ title: 'Remove member', message: `Remove ${m.username} from this channel?`, danger: true, confirmLabel: 'Remove' }))) return
                          const res = await apiFetch(
                            `/api/channel-members?channel_id=${encodeURIComponent(channelId)}&user_id=${encodeURIComponent(m.user_id)}`,
                            { method: 'DELETE' }
                          )
                          if (res.ok) {
                            void loadMembers()
                            void load()
                          }
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
                )}
              </>
            )
          })()}
        </div>
      )}
    </aside>
    {confirmDialog}
    </>
  )
}
