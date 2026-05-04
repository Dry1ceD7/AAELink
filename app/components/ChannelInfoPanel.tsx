'use client'

import { useCallback, useEffect, useState } from 'react'
import { Hash, Pin, X, Pencil, Users, Info, UserPlus, Archive, Trash2, BellOff, Bell, LogOut } from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'
import { MessageRichText } from '@/lib/messageRich'
import { isChannelMuted, toggleMuteChannel } from '@/lib/channelMute'

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

interface Props {
  channelId: string
  onClose: () => void
  onArchived?: () => void
  onLeft?: () => void
  onMuteToggled?: (muted: boolean) => void
  currentUserId: string
}

export function ChannelInfoPanel({ channelId, onClose, onArchived, onLeft, onMuteToggled, currentUserId }: Props) {
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

  useEffect(() => { void load() }, [load])
  useEffect(() => { if (tab === 'pins') void loadPins() }, [tab, loadPins])
  useEffect(() => { if (tab === 'members') void loadMembers() }, [tab, loadMembers])

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
    <aside className="channel-info-panel">
      <header className="channel-info-header">
        <h2><Info size={16} /> Channel details</h2>
        <button type="button" className="mm-icon-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </header>

      <div className="channel-info-tabs">
        <button type="button"
          className={`channel-info-tab${tab === 'about' ? ' channel-info-tab--active' : ''}`}
          onClick={() => setTab('about')}>About</button>
        <button type="button"
          className={`channel-info-tab${tab === 'members' ? ' channel-info-tab--active' : ''}`}
          onClick={() => setTab('members')}>
          <Users size={13} /> Members ({info?.member_count ?? 0})
        </button>
        <button type="button"
          className={`channel-info-tab${tab === 'pins' ? ' channel-info-tab--active' : ''}`}
          onClick={() => setTab('pins')}>
          <Pin size={13} /> Pinned ({info?.pinned_count ?? 0})
        </button>
      </div>

      {tab === 'about' && info && (
        <div className="channel-info-body">
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
                onClick={() => {
                  const next = toggleMuteChannel(channelId)
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
                  if (!confirm(`Leave #${info.display_name}? You can rejoin later.`)) return
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
                  if (!confirm('Are you sure you want to archive this channel?')) return
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
        </div>
      )}

      {tab === 'pins' && (
        <div className="channel-info-body">
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
        <div className="channel-info-body">
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
          {members.length === 0 ? (
            <div className="module-empty">
              <Users size={32} strokeWidth={1.5} />
              <h3>No members</h3>
            </div>
          ) : (
            <div className="channel-members-list">
              {members.map(m => (
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
                          if (!confirm(`Remove ${m.username} from this channel?`)) return
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
        </div>
      )}
    </aside>
  )
}
