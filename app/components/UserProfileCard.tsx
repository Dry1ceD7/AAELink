'use client'

import { memo, useState } from 'react'
import { X, Mail, MessageSquare, Shield, Clock, Phone, Building2, User, Copy, Check, BellOff } from 'lucide-react'

interface ProfileUser {
  id: string
  username: string
  first_name?: string
  last_name?: string
  nickname?: string
  platform_role?: string
  avatar_url?: string
  job_title?: string
  phone?: string
  timezone?: string
  status_text?: string
  status_emoji?: string
  pronouns?: string
  department?: string
  email?: string
}

interface Props {
  user: ProfileUser
  presenceStatus?: string
  onClose: () => void
  onStartDm?: (userId: string) => void
}

function displayName(u: ProfileUser): string {
  const full = `${u.first_name || ''} ${u.last_name || ''}`.trim()
  if (full) return full
  if (u.nickname) return u.nickname
  return u.username
}

const STATUS_COLOR: Record<string, string> = {
  online: 'var(--mm-online)',
  away: 'var(--mm-away)',
  dnd: '#d24b4e',
  offline: 'var(--mm-offline)'
}

const STATUS_LABEL: Record<string, string> = {
  online: 'Online',
  away: 'Away',
  dnd: 'Do Not Disturb',
  offline: 'Offline'
}

export const UserProfileCard = memo(function UserProfileCard({ user, presenceStatus, onClose, onStartDm }: Props) {
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const name = displayName(user)
  const initial = (user.username || name).slice(0, 1).toUpperCase()
  const status = presenceStatus || 'offline'
  const roleLabel = user.platform_role === 'superadmin' ? 'Super Admin'
    : user.platform_role === 'it_admin' ? 'IT Admin'
    : user.platform_role === 'it_support' ? 'IT Support'
    : 'Member'

  function copyToClipboard(text: string, field: string) {
    navigator.clipboard.writeText(text).catch(() => {})
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  return (
    <div className="user-profile-card">
      <div className="user-profile-card-header">
        <button type="button" className="mm-icon-btn" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <div className="user-profile-card-body">
        <div className="user-profile-card-avatar">
          {user.avatar_url ? (
            <img src={user.avatar_url} alt={name} className="user-profile-avatar-img" />
          ) : (
            initial
          )}
          <span className="user-profile-card-presence" style={{ background: STATUS_COLOR[status] || STATUS_COLOR.offline }} />
        </div>
        <h3 className="user-profile-card-name">
          {name} {user.status_emoji && <span className="user-status-emoji">{user.status_emoji}</span>}
        </h3>
        {user.pronouns && <p className="user-profile-card-pronouns">{user.pronouns}</p>}
        {user.job_title && <p className="user-profile-card-title">{user.job_title}</p>}
        <p className="user-profile-card-username">@{user.username}</p>

        {user.status_text && (
          <div className="user-profile-card-custom-status">
            {user.status_emoji} {user.status_text}
          </div>
        )}

        <div className="user-profile-card-status">
          <span className="user-profile-card-dot" style={{ background: STATUS_COLOR[status] || STATUS_COLOR.offline }} />
          {STATUS_LABEL[status] || 'Offline'}
        </div>

        {status === 'dnd' && (
          <div className="dnd-indicator">
            <BellOff size={14} /> Do Not Disturb
          </div>
        )}

        {user.timezone && (
          <div className="profile-local-time">
            <Clock size={12} />
            {(() => {
              try {
                return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: user.timezone })
                  + ` local time`
              } catch { return user.timezone }
            })()}
          </div>
        )}

        <div className="user-profile-card-role">
          <Shield size={13} />
          {roleLabel}
        </div>

        {user.department && (
          <div className="user-profile-card-detail">
            <span className="user-profile-card-label"><Building2 size={12} /> Department</span>
            <span>{user.department}</span>
          </div>
        )}

        {user.nickname && (
          <div className="user-profile-card-detail">
            <span className="user-profile-card-label"><User size={12} /> Nickname</span>
            <span>{user.nickname}</span>
          </div>
        )}

        {user.timezone && (
          <div className="user-profile-card-detail">
            <span className="user-profile-card-label"><Clock size={12} /> Timezone</span>
            <span>{user.timezone}</span>
          </div>
        )}

        {user.phone && (
          <div className="user-profile-card-detail">
            <span className="user-profile-card-label"><Phone size={12} /> Phone</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <a href={`tel:${user.phone}`}>{user.phone}</a>
              <button type="button" className="mm-icon-btn" title="Copy phone" style={{ padding: 2 }}
                onClick={() => copyToClipboard(user.phone!, 'phone')}>
                {copiedField === 'phone' ? <Check size={11} style={{ color: 'var(--mm-online)' }} /> : <Copy size={11} />}
              </button>
            </span>
          </div>
        )}

        {user.email && (
          <div className="user-profile-card-detail">
            <span className="user-profile-card-label"><Mail size={12} /> Email</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <a href={`mailto:${user.email}`}>{user.email}</a>
              <button type="button" className="mm-icon-btn" title="Copy email" style={{ padding: 2 }}
                onClick={() => copyToClipboard(user.email!, 'email')}>
                {copiedField === 'email' ? <Check size={11} style={{ color: 'var(--mm-online)' }} /> : <Copy size={11} />}
              </button>
            </span>
          </div>
        )}

        <div className="user-profile-card-actions">
          {onStartDm && (
            <button type="button" className="slack-button" onClick={() => onStartDm(user.id)}>
              <MessageSquare size={14} /> Message
            </button>
          )}
          <button type="button" className="ghost-button"
            onClick={() => { if (typeof window !== 'undefined') window.location.href = `mailto:${user.email || user.username + '@aae.local'}` }}>
            <Mail size={14} /> Email
          </button>
        </div>
      </div>
    </div>
  )
})

