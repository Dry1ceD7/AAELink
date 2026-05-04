'use client'

import { memo } from 'react'
import { X, Mail, MessageSquare, Shield, Clock } from 'lucide-react'

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
  const name = displayName(user)
  const initial = (user.username || name).slice(0, 1).toUpperCase()
  const status = presenceStatus || 'offline'
  const roleLabel = user.platform_role === 'superadmin' ? 'Super Admin'
    : user.platform_role === 'it_admin' ? 'IT Admin'
    : user.platform_role === 'it_support' ? 'IT Support'
    : 'Member'

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
            🔕 Do Not Disturb
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

        {user.nickname && (
          <div className="user-profile-card-detail">
            <span className="user-profile-card-label">Nickname</span>
            <span>{user.nickname}</span>
          </div>
        )}

        {user.timezone && (
          <div className="user-profile-card-detail">
            <span className="user-profile-card-label">Timezone</span>
            <span>{user.timezone}</span>
          </div>
        )}

        {user.phone && (
          <div className="user-profile-card-detail">
            <span className="user-profile-card-label">Phone</span>
            <span><a href={`tel:${user.phone}`}>{user.phone}</a></span>
          </div>
        )}

        <div className="user-profile-card-actions">
          {onStartDm && (
            <button type="button" className="slack-button" onClick={() => onStartDm(user.id)}>
              <MessageSquare size={14} /> Message
            </button>
          )}
          <button type="button" className="ghost-button"
            onClick={() => { if (typeof window !== 'undefined') window.location.href = `mailto:${user.username}@aae.local` }}>
            <Mail size={14} /> Email
          </button>
        </div>
      </div>
    </div>
  )
})
