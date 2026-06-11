'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  X, Mail, MessageSquare, Phone, Building2, Clock, Shield, Headphones,
  Loader2, AlertCircle, RefreshCw, Copy, Check, Calendar, Smile, Pencil,
} from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import { AvatarLightbox } from '@/components/media/AvatarLightbox'
import { CustomStatusPopup } from '@/app/home/CustomStatusPopup'
import { ProfileEditModal } from '@/components/user/ProfileEditModal'

/* ─────────────────────────────────────────────────────────────────────
   UserProfilePanel — right-rail profile pane (Slack §9.2 parity).

   - Replaces the deprecated `UserProfileCard` popup.
   - Slots into the same right-rail real estate as ChannelInfoPanel,
     ThreadPanel, PinnedMessagesPanel, MemberListPanel. Mutual-exclusion
     is enforced by the page-level state owner.
   - Reuses `GET /api/users/profile?user_id=<id>` — no new endpoints.
   - Eight sections rendered top-to-bottom: header, status, actions,
     contact, about, dept/title, timezone, member-since.
   ───────────────────────────────────────────────────────────────────── */

interface ProfileApiResponse {
  user: {
    id: string
    username: string
    email?: string
    display_name?: string
    platform_role?: string
    avatar_url?: string
    status?: string
    created_at: number
  }
  profile: Record<string, string>
  custom_status: { status_text?: string; status_emoji?: string; expires_at?: number } | null
  department_name?: string
}

const STATUS_COLOR: Record<string, string> = {
  online: 'var(--mm-online, #2bac76)',
  active: 'var(--mm-online, #2bac76)',
  away: 'var(--mm-away, #e8912d)',
  dnd: '#d24b4e',
  offline: 'var(--mm-offline, #888)',
}

const STATUS_LABEL: Record<string, string> = {
  online: 'Active',
  active: 'Active',
  away: 'Away',
  dnd: 'Do Not Disturb',
  offline: 'Offline',
}

interface Props {
  /** The user id to fetch and display. Pane returns null when this is null. */
  userId: string | null
  /**
   * The signed-in viewer's id. When it equals `userId` the pane is showing the
   * viewer's OWN profile, which unlocks the "Set status" action (opens the shared
   * CustomStatusPopup). Optional so existing callers that never pass it simply
   * never see the self-only affordance.
   */
  currentUserId?: string | null
  /** Pre-resolved presence string from the page-level helper. */
  presenceStatus: string
  /** Pane wants to close itself (Esc, X, error close button). */
  onClose: () => void
  /** Open or create a DM with this user. */
  onMessage: (userId: string) => void
  /** Start / join a huddle with this user. */
  onHuddle: (userId: string) => void
  /**
   * Open the (future) full profile page. When undefined the button is
   * disabled and tooltipped — reserves the slot without committing.
   */
  onViewFullProfile?: (userId: string) => void
}

function relativeDate(ts: number): string {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function localTimeFor(timezone: string): string {
  if (!timezone) return ''
  try {
    return new Date().toLocaleTimeString(undefined, {
      hour: '2-digit', minute: '2-digit', timeZone: timezone,
    })
  } catch {
    return ''
  }
}

export const UserProfilePanel = memo(function UserProfilePanel({
  userId, currentUserId, presenceStatus, onClose, onMessage, onHuddle, onViewFullProfile,
}: Props) {
  const [data, setData] = useState<ProfileApiResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [statusPopupOpen, setStatusPopupOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // True only when the viewer is looking at their OWN profile. Drives the
  // self-only "Set status" affordance.
  const isOwnProfile = !!userId && !!currentUserId && userId === currentUserId

  const load = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    setError(null)
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    try {
      const res = await apiFetch(
        `/api/users/profile?user_id=${encodeURIComponent(userId)}`,
        { signal: abortRef.current.signal }
      )
      if (!res.ok) {
        setError('Could not load profile.')
        setData(null)
        return
      }
      const body = (await res.json()) as ProfileApiResponse
      setData(body)
    } catch (e) {
      // Aborts are intentional — only surface real errors.
      if ((e as Error).name === 'AbortError') return
      setError('Could not load profile.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    if (!userId) {
      setData(null)
      setError(null)
      return
    }
    void load()
    return () => abortRef.current?.abort()
  }, [userId, load])

  // Esc closes the pane — only attached while open.
  useEffect(() => {
    if (!userId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [userId, onClose])

  const copyToClipboard = useCallback((value: string, field: string) => {
    if (!value) return
    void navigator.clipboard?.writeText(value).catch(() => {})
    setCopiedField(field)
    window.setTimeout(() => setCopiedField(null), 1800)
  }, [])

  const displayName = useMemo(() => {
    if (!data) return ''
    return data.user.display_name?.trim() || data.user.username
  }, [data])

  const initial = (displayName || 'U').charAt(0).toUpperCase()
  const profile = data?.profile || {}
  const pronouns = profile['profile.pronouns'] || ''
  const title = profile['profile.title'] || ''
  const about = profile['profile.about'] || ''
  const phone = profile['profile.phone'] || ''
  const timezone = profile['profile.timezone'] || ''
  const department = data?.department_name || ''
  const customStatus = data?.custom_status

  if (!userId) return null

  return (
    <aside
      className="user-profile-panel aae-rhs-enter"
      role="complementary"
      aria-label={data ? `Profile for ${displayName}` : 'Profile'}
    >
      {/* Header chrome — close button stays even during load/error */}
      <header className="user-profile-panel-head">
        <h2 className="user-profile-panel-title">Profile</h2>
        <button
          type="button"
          className="mm-icon-btn"
          onClick={onClose}
          aria-label="Close profile"
        >
          <X size={16} />
        </button>
      </header>

      {loading && !data && (
        <div className="user-profile-panel-state">
          <Loader2 size={16} className="spin" /> <span>Loading profile…</span>
        </div>
      )}

      {error && (
        <div className="user-profile-panel-state user-profile-panel-state--error" role="alert">
          <AlertCircle size={14} /> <span>{error}</span>
          <button type="button" className="ghost-button" onClick={() => void load()}>
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      )}

      {data && !error && (
        <div className="user-profile-panel-body">
          {/* 1. Identity */}
          <section className="user-profile-panel-identity">
            <button
              type="button"
              className="user-profile-panel-avatar"
              onClick={() => { if (data.user.avatar_url) setLightboxOpen(true) }}
              aria-label={data.user.avatar_url ? `View ${displayName}'s photo full size` : displayName}
              disabled={!data.user.avatar_url}
              style={{ cursor: data.user.avatar_url ? 'zoom-in' : 'default' }}
            >
              {data.user.avatar_url ? (
                <img src={data.user.avatar_url} alt={displayName} />
              ) : (
                <span aria-hidden="true">{initial}</span>
              )}
              <span
                className="user-profile-panel-presence"
                style={{ background: STATUS_COLOR[presenceStatus] || STATUS_COLOR.offline }}
              />
            </button>
            <h3 className="user-profile-panel-name">{displayName}</h3>
            {pronouns && <p className="user-profile-panel-pronouns">{pronouns}</p>}
            {title && <p className="user-profile-panel-title-line">{title}</p>}
            <p className="user-profile-panel-handle">@{data.user.username}</p>
          </section>

          {/* 2. Status + custom status + local time */}
          <section className="user-profile-panel-status">
            <span
              className="user-profile-panel-presence-dot"
              style={{ background: STATUS_COLOR[presenceStatus] || STATUS_COLOR.offline }}
            />
            <span>{STATUS_LABEL[presenceStatus] || 'Offline'}</span>
            {customStatus?.status_text && (
              <span className="user-profile-panel-custom-status">
                · {customStatus.status_emoji} {customStatus.status_text}
              </span>
            )}
            {timezone && (
              <span className="user-profile-panel-localtime">
                <Clock size={11} aria-hidden /> {localTimeFor(timezone)} local
              </span>
            )}
          </section>

          {/* 3. Action buttons */}
          <section className="user-profile-panel-actions">
            {isOwnProfile && (
              <button
                type="button"
                className="ghost-button"
                onClick={() => setStatusPopupOpen(true)}
              >
                <Smile size={14} /> Set status
              </button>
            )}
            {isOwnProfile && (
              <button
                type="button"
                className="ghost-button"
                onClick={() => setEditOpen(true)}
              >
                <Pencil size={14} /> Edit profile
              </button>
            )}
            <button
              type="button"
              className="slack-button"
              onClick={() => onMessage(data.user.id)}
            >
              <MessageSquare size={14} /> Message
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => onHuddle(data.user.id)}
            >
              <Headphones size={14} /> Huddle
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => onViewFullProfile?.(data.user.id)}
              disabled={!onViewFullProfile}
              title={onViewFullProfile ? undefined : 'Coming in a future release'}
            >
              View full profile
            </button>
          </section>

          {/* 4. Contact */}
          {(data.user.email || phone) && (
            <section className="user-profile-panel-section">
              <h4>Contact</h4>
              {data.user.email && (
                <div className="user-profile-panel-row">
                  <span className="user-profile-panel-row-label"><Mail size={12} aria-hidden /> Email</span>
                  <span className="user-profile-panel-row-value">
                    <a href={`mailto:${data.user.email}`}>{data.user.email}</a>
                    <button
                      type="button"
                      className="mm-icon-btn"
                      title="Copy email"
                      onClick={() => copyToClipboard(data.user.email!, 'email')}
                    >
                      {copiedField === 'email' ? <Check size={11} /> : <Copy size={11} />}
                    </button>
                  </span>
                </div>
              )}
              {phone && (
                <div className="user-profile-panel-row">
                  <span className="user-profile-panel-row-label"><Phone size={12} aria-hidden /> Phone</span>
                  <span className="user-profile-panel-row-value">
                    <a href={`tel:${phone}`}>{phone}</a>
                    <button
                      type="button"
                      className="mm-icon-btn"
                      title="Copy phone"
                      onClick={() => copyToClipboard(phone, 'phone')}
                    >
                      {copiedField === 'phone' ? <Check size={11} /> : <Copy size={11} />}
                    </button>
                  </span>
                </div>
              )}
            </section>
          )}

          {/* 5. About me */}
          <section className="user-profile-panel-section">
            <h4>About</h4>
            <p className="user-profile-panel-about">
              {about || <em className="muted">No bio yet.</em>}
            </p>
          </section>

          {/* 6. Job title + Department */}
          {(department || title) && (
            <section className="user-profile-panel-section">
              <h4>Role</h4>
              {title && (
                <div className="user-profile-panel-row">
                  <span className="user-profile-panel-row-label"><Shield size={12} aria-hidden /> Title</span>
                  <span>{title}</span>
                </div>
              )}
              {department && (
                <div className="user-profile-panel-row">
                  <span className="user-profile-panel-row-label"><Building2 size={12} aria-hidden /> Department</span>
                  <span>{department}</span>
                </div>
              )}
            </section>
          )}

          {/* 7. Timezone */}
          {timezone && (
            <section className="user-profile-panel-section">
              <h4>Timezone</h4>
              <div className="user-profile-panel-row">
                <span className="user-profile-panel-row-label"><Clock size={12} aria-hidden /> Local time</span>
                <span>{timezone} · {localTimeFor(timezone)}</span>
              </div>
            </section>
          )}

          {/* 8. Member since */}
          <section className="user-profile-panel-section">
            <h4>Member</h4>
            <div className="user-profile-panel-row">
              <span className="user-profile-panel-row-label"><Calendar size={12} aria-hidden /> Joined</span>
              <span>{relativeDate(data.user.created_at)}</span>
            </div>
          </section>
        </div>
      )}

      {/* Avatar lightbox — uses the existing AvatarLightbox utility. */}
      {data && (
        <AvatarLightbox
          src={lightboxOpen && data.user.avatar_url ? data.user.avatar_url : null}
          name={displayName}
          onClose={() => setLightboxOpen(false)}
        />
      )}

      {/* Set-status — reuses the shared CustomStatusPopup (it self-fetches the
          signed-in user's status, so no userId is threaded). Only mounted for the
          viewer's own profile. Reload the profile on close so the panel reflects a
          just-saved/cleared status. */}
      {isOwnProfile && (
        <CustomStatusPopup
          open={statusPopupOpen}
          onClose={() => { setStatusPopupOpen(false); void load() }}
        />
      )}

      {/* Edit-profile modal — self-only. Refetch the pane on a successful save
          so it reflects the just-persisted edits; the modal closes itself. */}
      {isOwnProfile && (
        <ProfileEditModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSaved={() => void load()}
        />
      )}
    </aside>
  )
})
