'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, BellOff, Eye, EyeOff, KeyRound, Loader2, Shield, User, Download, RefreshCw, CheckCircle, ExternalLink } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/apiClient'
import { EmergencyContactPanel } from '@/app/components/EmergencyContactPanel'
import { SessionManagementPanel } from '@/app/components/SessionManagementPanel'
import { TabList } from '@/app/components/a11y'
import { persistUiDensity, readUiDensity, type UiDensity } from '@/lib/uiDensity'
import { readThemePreference, persistThemePreference, type ThemePreference } from '@/lib/theme'
import { getNotifSoundPref, setNotifSoundPref, getNotifVolume, setNotifVolume, playNotificationSound, type NotifSoundPref } from '@/lib/notificationSound'
import { getDndSchedule, setDndSchedule, formatSchedule, type DndSchedule } from '@/lib/dndSchedule'

const phone = process.env.NEXT_PUBLIC_AAELINK_IT_PHONE?.trim() || ''
const email = process.env.NEXT_PUBLIC_AAELINK_IT_EMAIL?.trim() || ''
const liveChat = process.env.NEXT_PUBLIC_AAELINK_IT_LIVE_CHAT_URL?.trim() || ''

interface MeUser {
  id: string
  username: string
  email: string
  first_name: string
  last_name: string
  nickname: string
  platform_role?: string
  avatar_url?: string
  job_title?: string
  phone?: string
  timezone?: string
  status_text?: string
  status_emoji?: string
}

type SettingsTab = 'profile' | 'security' | 'notifications' | 'preferences' | 'updates' | 'help'

const PANEL_TITLE: Record<SettingsTab, string> = {
  profile: 'Profile',
  security: 'Security',
  notifications: 'Notifications',
  preferences: 'Preferences',
  updates: 'Updates',
  help: 'Help and IT'
}

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'security', label: 'Security' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'updates', label: 'Updates' },
  { id: 'help', label: 'Help' }
]

interface GitHubRelease {
  latest_version: string
  name: string
  notes: string
  url: string
  published_at: string
  assets: Array<{
    name: string
    download_url: string
    size: number
    downloads: number
  }>
}

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.2-alpha'

export type SettingsShellVariant = 'page' | 'drawer'

export type SettingsShellProps = {
  variant: SettingsShellVariant
  onClose?: () => void
}

export function SettingsShell({ variant, onClose }: SettingsShellProps) {
  const router = useRouter()
  const [tab, setTab] = useState<SettingsTab>('profile')
  const [user, setUser] = useState<MeUser | null>(null)
  const [err, setErr] = useState('')
  const [prefMentions, setPrefMentions] = useState(true)
  const [prefTicketActivity, setPrefTicketActivity] = useState(true)
  const [prefSystemNotify, setPrefSystemNotify] = useState(true)
  const [prefLoading, setPrefLoading] = useState(true)
  const [prefSaving, setPrefSaving] = useState(false)
  const [prefErr, setPrefErr] = useState('')
  const [uiDensity, setUiDensity] = useState<UiDensity>('comfortable')
  const [themePref, setThemePref] = useState<ThemePreference>('system')
  // Security tab state
  const [curPassword, setCurPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurPw, setShowCurPw] = useState(false)
  const [showNewPw, setShowNewPw] = useState(false)
  const [pwChanging, setPwChanging] = useState(false)
  const [pwSuccess, setPwSuccess] = useState('')
  const [pwError, setPwError] = useState('')
  // Updates tab state
  const [updateInfo, setUpdateInfo] = useState<GitHubRelease | null>(null)
  const [updateLoading, setUpdateLoading] = useState(false)
  const [updateError, setUpdateError] = useState('')
  const [updateChecked, setUpdateChecked] = useState(false)

  const load = useCallback(() => {
    setErr('')
    return apiFetch('/api/auth/me')
      .then(r => {
        if (r.status === 401) {
          router.replace('/login')
          return null
        }
        return r.ok ? r.json() : null
      })
      .then(data => {
        if (data?.user) setUser(data.user as MeUser)
        else if (data === null) {
          /* redirect */
        } else setErr('Could not load profile.')
      })
      .catch(() => setErr('Could not load profile.'))
  }, [router])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setUiDensity(readUiDensity())
    setThemePref(readThemePreference())
  }, [])

  const loadPrefs = useCallback(() => {
    setPrefErr('')
    setPrefLoading(true)
    return apiFetch('/api/auth/notification-prefs')
      .then(r => {
        if (r.status === 401) {
          router.replace('/login')
          return null
        }
        return r.ok ? r.json() : null
      })
      .then(data => {
        if (data === null) return
        if (!data || typeof data !== 'object') {
          setPrefErr('Could not load notification preferences.')
          return
        }
        const d = data as {
          mentions_enabled?: boolean
          ticket_activity_enabled?: boolean
          system_notifications_enabled?: boolean
        }
        if (typeof d.mentions_enabled === 'boolean') setPrefMentions(d.mentions_enabled)
        if (typeof d.ticket_activity_enabled === 'boolean') setPrefTicketActivity(d.ticket_activity_enabled)
        if (typeof d.system_notifications_enabled === 'boolean') setPrefSystemNotify(d.system_notifications_enabled)
      })
      .catch(() => setPrefErr('Could not load notification preferences.'))
      .finally(() => setPrefLoading(false))
  }, [router])

  useEffect(() => {
    if (!user) return
    void loadPrefs()
  }, [user, loadPrefs])

  /** Keep the active settings tab visible when the left rail scrolls (short drawer / zoomed UI). */
  useEffect(() => {
    const rafId = window.requestAnimationFrame(() => {
      const btn = document.getElementById(`mm-settings-tab-${tab}`)
      if (!btn) return
      const reduce =
        typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      btn.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: reduce ? 'auto' : 'smooth'
      })
    })
    return () => window.cancelAnimationFrame(rafId)
  }, [tab])

  async function savePrefs(next: {
    mentions_enabled?: boolean
    ticket_activity_enabled?: boolean
    system_notifications_enabled?: boolean
  }) {
    setPrefSaving(true)
    setPrefErr('')
    const res = await apiFetch('/api/auth/notification-prefs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next)
    })
    setPrefSaving(false)
    if (!res.ok) {
      setPrefErr('Could not save preferences.')
      void loadPrefs()
      return
    }
    const data = (await res.json()) as {
      mentions_enabled?: boolean
      ticket_activity_enabled?: boolean
      system_notifications_enabled?: boolean
    }
    if (typeof data.mentions_enabled === 'boolean') setPrefMentions(data.mentions_enabled)
    if (typeof data.ticket_activity_enabled === 'boolean') setPrefTicketActivity(data.ticket_activity_enabled)
    if (typeof data.system_notifications_enabled === 'boolean') setPrefSystemNotify(data.system_notifications_enabled)
  }

  async function requestBrowserNotifyPermission() {
    if (typeof Notification === 'undefined' || Notification.permission !== 'default') return
    try {
      await Notification.requestPermission()
    } catch {
      /* ignore */
    }
  }

  function signOut() {
    void apiFetch('/api/auth/logout', { method: 'POST' }).then(() => {
      window.location.href = '/login'
    })
  }

  const checkForUpdates = useCallback(async () => {
    setUpdateLoading(true)
    setUpdateError('')
    try {
      // Try desktop IPC first (electron-updater), fallback to web API
      const desktop = typeof window !== 'undefined'
        ? (window as Window & { aaelinkDesktop?: { checkForUpdate?: () => Promise<unknown> } }).aaelinkDesktop
        : undefined
      if (desktop && typeof desktop.checkForUpdate === 'function') {
        await desktop.checkForUpdate()
      }
      // Always also fetch from GitHub API for display
      const res = await apiFetch('/api/updates/check')
      if (res.ok) {
        const data = await res.json() as GitHubRelease
        setUpdateInfo(data)
        setUpdateChecked(true)
      } else {
        const errData = await res.json().catch(() => ({})) as { message?: string }
        setUpdateError(errData.message || `Failed to check (HTTP ${res.status})`)
      }
    } catch (e) {
      setUpdateError((e as Error).message || 'Network error')
    } finally {
      setUpdateLoading(false)
    }
  }, [])

  // Auto-check for updates when the updates tab opens
  useEffect(() => {
    if (tab === 'updates' && !updateChecked && !updateLoading) {
      void checkForUpdates()
    }
  }, [tab, updateChecked, updateLoading, checkForUpdates])

  const display = user
    ? [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || user.nickname || user.username
    : ''

  const profileAvatarLetter = user
    ? (display.trim().charAt(0) || user.username.charAt(0) || '').toUpperCase()
    : ''

  const isDrawer = variant === 'drawer'

  const tabNav = (
    <TabList
      tabs={SETTINGS_TABS}
      value={tab}
      onChange={id => setTab(id as SettingsTab)}
      ariaLabel="Settings sections"
      orientation="vertical"
      idPrefix="mm-settings"
      className="mm-settings-rail mm-settings-nav"
      tabClassName={active => `mm-settings-nav-item${active ? ' mm-settings-nav-item--active' : ''}`}
    />
  )

  const body = (
    <>
      {err ? (
        <div className="mm-auth-alert mm-auth-alert--error" role="alert" style={{ marginBottom: 14 }}>
          <AlertCircle size={18} strokeWidth={2} aria-hidden />
          <span>{err}</span>
        </div>
      ) : null}
      {!user && !err ? (
        <p className="mm-auth-settings-loading mm-settings-lead" style={{ marginBottom: 0 }}>
          <Loader2 size={20} className="spin" aria-hidden />
          Loading profile
        </p>
      ) : null}
      {user && tab === 'profile' ? (
        <section>
          <p className="mm-settings-lead">
            Edit your display name and nickname. Username and email are managed by IT.
          </p>
          <div className="mm-settings-profile-top">
            <div className="mm-settings-avatar" aria-hidden>
              {profileAvatarLetter ? <span>{profileAvatarLetter}</span> : <User size={28} strokeWidth={2} aria-hidden />}
            </div>
            <div className="mm-settings-profile-names">
              <p className="mm-settings-profile-name">{display}</p>
              <p className="mm-settings-profile-handle">@{user.username}</p>
              {user.platform_role && (
                <span className={`mm-settings-role-badge${user.platform_role === 'super_admin' ? ' mm-settings-role-badge--admin' : ''}`} style={{ marginTop: 4 }}>
                  {user.platform_role === 'super_admin' ? 'Administrator'
                    : user.platform_role === 'it_admin' ? 'IT Admin'
                    : user.platform_role === 'it_support' ? 'IT Support'
                    : 'Member'}
                </span>
              )}
            </div>
          </div>

          <ProfileEditForm user={user} onSaved={(u) => setUser(u)} />

          <dl className="mm-settings-dl" style={{ marginTop: 16 }}>
            <div className="mm-settings-dl-row">
              <dt className="mm-settings-dl-label">User name</dt>
              <dd className="mm-settings-dl-value">@{user.username}</dd>
            </div>
            <div className="mm-settings-dl-row">
              <dt className="mm-settings-dl-label">Email</dt>
              <dd className="mm-settings-dl-value">{user.email}</dd>
            </div>
          </dl>
        </section>
      ) : null}
      {user && tab === 'security' ? (
        <section>
          {/* ── Account info ───────────────────────────────────────── */}
          <h3 className="mm-settings-section-h">
            <Shield size={16} strokeWidth={2} aria-hidden style={{ marginRight: 6, verticalAlign: -2 }} />
            Account
          </h3>
          <dl className="mm-settings-dl">
            <div className="mm-settings-dl-row">
              <dt className="mm-settings-dl-label">Account ID</dt>
              <dd className="mm-settings-dl-value" style={{ fontFamily: 'monospace', fontSize: 12 }}>{user.id}</dd>
            </div>
            <div className="mm-settings-dl-row">
              <dt className="mm-settings-dl-label">User name</dt>
              <dd className="mm-settings-dl-value">@{user.username}</dd>
            </div>
            <div className="mm-settings-dl-row">
              <dt className="mm-settings-dl-label">Email</dt>
              <dd className="mm-settings-dl-value">{user.email}</dd>
            </div>
            <div className="mm-settings-dl-row">
              <dt className="mm-settings-dl-label">Role</dt>
              <dd className="mm-settings-dl-value">
                <span className={`mm-settings-role-badge${user.platform_role === 'super_admin' ? ' mm-settings-role-badge--admin' : ''}`}>
                  {user.platform_role === 'super_admin' ? 'Administrator' : 'Member'}
                </span>
              </dd>
            </div>
          </dl>

          {/* ── Change password ─────────────────────────────────────── */}
          <h3 className="mm-settings-section-h" style={{ marginTop: 24 }}>
            <KeyRound size={16} strokeWidth={2} aria-hidden style={{ marginRight: 6, verticalAlign: -2 }} />
            Change password
          </h3>
          <p className="mm-settings-lead">
            Choose a strong password with at least 8 characters. After changing your password you will remain signed in.
          </p>

          {pwSuccess ? (
            <div className="mm-auth-alert mm-auth-alert--info" role="status" style={{ marginBottom: 12 }}>
              {pwSuccess}
            </div>
          ) : null}
          {pwError ? (
            <div className="mm-auth-alert mm-auth-alert--error" role="alert" style={{ marginBottom: 12 }}>
              <AlertCircle size={18} strokeWidth={2} aria-hidden />
              <span>{pwError}</span>
            </div>
          ) : null}

          <form
            className="mm-settings-pw-form"
            onSubmit={async (e) => {
              e.preventDefault()
              setPwError('')
              setPwSuccess('')
              if (!curPassword.trim()) { setPwError('Current password is required.'); return }
              if (newPassword.length < 8) { setPwError('New password must be at least 8 characters.'); return }
              if (newPassword !== confirmPassword) { setPwError('New passwords do not match.'); return }
              if (curPassword === newPassword) { setPwError('New password must be different from current password.'); return }
              setPwChanging(true)
              try {
                const res = await apiFetch('/api/auth/change-password', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ current_password: curPassword, new_password: newPassword })
                })
                if (res.ok) {
                  setPwSuccess('Password changed successfully.')
                  setCurPassword('')
                  setNewPassword('')
                  setConfirmPassword('')
                  setShowCurPw(false)
                  setShowNewPw(false)
                } else {
                  let j: { error?: string } = {}
                  try { j = (await res.json()) as { error?: string } } catch { /* ignore */ }
                  if (j.error === 'invalid_credentials') setPwError('Current password is incorrect.')
                  else if (j.error === 'password_too_short') setPwError('New password must be at least 8 characters.')
                  else if (j.error === 'password_same') setPwError('New password must be different from current password.')
                  else setPwError('Could not change password. Try again or contact IT.')
                }
              } catch {
                setPwError('Network error. Try again.')
              } finally {
                setPwChanging(false)
              }
            }}
          >
            <label className="field-label" htmlFor="settings-cur-pw">Current password</label>
            <div className="mm-auth-password-wrap">
              <input
                id="settings-cur-pw"
                className="slack-input"
                type={showCurPw ? 'text' : 'password'}
                value={curPassword}
                onChange={e => setCurPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="mm-auth-password-toggle"
                aria-label={showCurPw ? 'Hide' : 'Show'}
                onClick={() => setShowCurPw(v => !v)}
              >
                {showCurPw ? <EyeOff size={16} strokeWidth={2} aria-hidden /> : <Eye size={16} strokeWidth={2} aria-hidden />}
              </button>
            </div>

            <label className="field-label" htmlFor="settings-new-pw">New password</label>
            <div className="mm-auth-password-wrap">
              <input
                id="settings-new-pw"
                className="slack-input"
                type={showNewPw ? 'text' : 'password'}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
              <button
                type="button"
                className="mm-auth-password-toggle"
                aria-label={showNewPw ? 'Hide' : 'Show'}
                onClick={() => setShowNewPw(v => !v)}
              >
                {showNewPw ? <EyeOff size={16} strokeWidth={2} aria-hidden /> : <Eye size={16} strokeWidth={2} aria-hidden />}
              </button>
            </div>

            <label className="field-label" htmlFor="settings-confirm-pw">Confirm new password</label>
            <input
              id="settings-confirm-pw"
              className="slack-input"
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />

            <button
              type="submit"
              className="slack-button"
              style={{ marginTop: 16, alignSelf: 'flex-start' }}
              disabled={pwChanging}
            >
              {pwChanging ? (
                <><Loader2 size={16} className="spin" aria-hidden style={{ marginRight: 6 }} />Changing…</>
              ) : (
                'Change password'
              )}
            </button>
          </form>

          {/* ── Active sessions / device management ────────────────── */}
          <div style={{ marginTop: 32, borderTop: '1px solid var(--mm-border-subtle)', paddingTop: 24 }}>
            <SessionManagementPanel />
          </div>
        </section>
      ) : null}
      {user && tab === 'notifications' ? (
        <section>
          <p className="mm-settings-lead">
            Choose which in-app alerts you want. Turning an option off stops new items of that type; it does not delete your existing list.
          </p>
          <p className="mm-settings-lead">
            Desktop alerts when the window is in the background use your browser permission. You can allow or block them in the browser when prompted.
          </p>
          {prefErr ? (
            <div className="mm-auth-alert mm-auth-alert--error" role="alert" style={{ marginBottom: 12 }}>
              <AlertCircle size={18} strokeWidth={2} aria-hidden />
              <span>{prefErr}</span>
            </div>
          ) : null}
          {prefLoading ? (
            <p className="mm-auth-settings-loading mm-settings-lead" style={{ marginBottom: 0 }}>
              <Loader2 size={20} className="spin" aria-hidden />
              Loading notification preferences
            </p>
          ) : (
            <div className="mm-settings-stack">
              <label className="mm-settings-setting-row" htmlFor="pref-mentions">
                <span className="mm-settings-setting-text">
                  <span className="mm-settings-setting-title" id="pref-mentions-label">
                    Mentions and @-references
                  </span>
                  <span className="mm-settings-setting-desc" id="pref-mentions-desc">
                    When someone mentions you in a channel or on a ticket.
                  </span>
                </span>
                <span className="mm-settings-setting-control">
                  <input
                    id="pref-mentions"
                    type="checkbox"
                    checked={prefMentions}
                    disabled={prefSaving}
                    aria-labelledby="pref-mentions-label"
                    aria-describedby="pref-mentions-desc"
                    onChange={e => {
                      const v = e.target.checked
                      setPrefMentions(v)
                      void savePrefs({ mentions_enabled: v })
                    }}
                  />
                </span>
              </label>
              <label className="mm-settings-setting-row" htmlFor="pref-ticket">
                <span className="mm-settings-setting-text">
                  <span className="mm-settings-setting-title" id="pref-ticket-label">
                    Ticket replies
                  </span>
                  <span className="mm-settings-setting-desc" id="pref-ticket-desc">
                    When someone replies to a ticket you opened.
                  </span>
                </span>
                <span className="mm-settings-setting-control">
                  <input
                    id="pref-ticket"
                    type="checkbox"
                    checked={prefTicketActivity}
                    disabled={prefSaving}
                    aria-labelledby="pref-ticket-label"
                    aria-describedby="pref-ticket-desc"
                    onChange={e => {
                      const v = e.target.checked
                      setPrefTicketActivity(v)
                      void savePrefs({ ticket_activity_enabled: v })
                    }}
                  />
                </span>
              </label>
              <label className="mm-settings-setting-row" htmlFor="pref-desktop">
                <span className="mm-settings-setting-text">
                  <span className="mm-settings-setting-title" id="pref-desktop-label">
                    Desktop notifications
                  </span>
                  <span className="mm-settings-setting-desc" id="pref-desktop-desc">
                    Show a desktop notification when this site is in the background (optional). Turning this off also silences urgent IT queue alerts for administrators.
                  </span>
                </span>
                <span className="mm-settings-setting-control">
                  <input
                    id="pref-desktop"
                    type="checkbox"
                    checked={prefSystemNotify}
                    disabled={prefSaving}
                    aria-labelledby="pref-desktop-label"
                    aria-describedby="pref-desktop-desc"
                    onChange={e => {
                      const v = e.target.checked
                      setPrefSystemNotify(v)
                      if (v) void requestBrowserNotifyPermission()
                      void savePrefs({ system_notifications_enabled: v })
                    }}
                  />
                </span>
              </label>

              {/* ── Notification sound preference ──────────────────── */}
              <div style={{ marginTop: 12, padding: '0 4px' }}>
                <p className="field-label" style={{ marginBottom: 8 }}>Notification sound</p>
                <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
                  {(['default', 'subtle', 'none'] as NotifSoundPref[]).map(opt => (
                    <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="notif-sound"
                        value={opt}
                        defaultChecked={getNotifSoundPref() === opt}
                        onChange={() => { setNotifSoundPref(opt); if (opt !== 'none') setTimeout(playNotificationSound, 100) }}
                      />
                      {opt === 'default' ? 'Default' : opt === 'subtle' ? 'Subtle' : 'None'}
                    </label>
                  ))}
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  Volume
                  <input
                    type="range"
                    min={0} max={1} step={0.05}
                    defaultValue={getNotifVolume()}
                    style={{ flex: 1, maxWidth: 180 }}
                    onChange={e => setNotifVolume(parseFloat(e.target.value))}
                  />
                </label>
              </div>

              {/* ── Do Not Disturb schedule ──────────────────────── */}
              <div style={{ marginTop: 16, padding: '0 4px' }}>
                <p className="field-label" style={{ marginBottom: 8 }}>Do Not Disturb schedule</p>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginBottom: 8 }}>
                  <input
                    type="checkbox"
                    defaultChecked={getDndSchedule().enabled}
                    onChange={e => {
                      const s = getDndSchedule()
                      setDndSchedule({ ...s, enabled: e.target.checked })
                    }}
                  />
                  Automatically pause notifications on a schedule
                </label>
                {getDndSchedule().enabled && (
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 13 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      From
                      <input
                        type="time"
                        className="slack-input"
                        style={{ width: 100, fontSize: 13, padding: '4px 8px' }}
                        defaultValue={`${String(getDndSchedule().startHour).padStart(2, '0')}:${String(getDndSchedule().startMinute).padStart(2, '0')}`}
                        onChange={e => {
                          const [h, m] = e.target.value.split(':').map(Number)
                          const s = getDndSchedule()
                          setDndSchedule({ ...s, startHour: h!, startMinute: m! })
                        }}
                      />
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      To
                      <input
                        type="time"
                        className="slack-input"
                        style={{ width: 100, fontSize: 13, padding: '4px 8px' }}
                        defaultValue={`${String(getDndSchedule().endHour).padStart(2, '0')}:${String(getDndSchedule().endMinute).padStart(2, '0')}`}
                        onChange={e => {
                          const [h, m] = e.target.value.split(':').map(Number)
                          const s = getDndSchedule()
                          setDndSchedule({ ...s, endHour: h!, endMinute: m! })
                        }}
                      />
                    </label>
                  </div>
                )}
                {getDndSchedule().enabled && (
                  <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--mm-muted)' }}>
                    <BellOff size={12} aria-hidden style={{ verticalAlign: -1, marginRight: 4 }} />Notifications paused daily {formatSchedule(getDndSchedule())}
                  </p>
                )}
              </div>
            </div>
          )}
        </section>
      ) : null}
      {user && tab === 'preferences' ? (
        <section>
          <p className="mm-settings-lead">
            Customise your appearance, layout, and display settings.
          </p>

          {/* ── Theme selection ─────────────────── */}
          <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
            <legend className="visually-hidden">Theme</legend>
            <p className="field-label mm-settings-pref-legend">Theme</p>
            <div className="mm-settings-stack">
              <label className="mm-settings-setting-row" htmlFor="pref-theme-light">
                <span className="mm-settings-setting-text">
                  <span className="mm-settings-setting-title" id="theme-light-label">Light</span>
                  <span className="mm-settings-setting-desc" id="theme-light-desc">Always use the light colour scheme.</span>
                </span>
                <span className="mm-settings-setting-control">
                  <input
                    id="pref-theme-light"
                    type="radio"
                    name="aae-theme"
                    checked={themePref === 'light'}
                    aria-labelledby="theme-light-label"
                    aria-describedby="theme-light-desc"
                    onChange={() => { setThemePref('light'); persistThemePreference('light') }}
                  />
                </span>
              </label>
              <label className="mm-settings-setting-row" htmlFor="pref-theme-dark">
                <span className="mm-settings-setting-text">
                  <span className="mm-settings-setting-title" id="theme-dark-label">Dark</span>
                  <span className="mm-settings-setting-desc" id="theme-dark-desc">Always use the dark colour scheme.</span>
                </span>
                <span className="mm-settings-setting-control">
                  <input
                    id="pref-theme-dark"
                    type="radio"
                    name="aae-theme"
                    checked={themePref === 'dark'}
                    aria-labelledby="theme-dark-label"
                    aria-describedby="theme-dark-desc"
                    onChange={() => { setThemePref('dark'); persistThemePreference('dark') }}
                  />
                </span>
              </label>
              <label className="mm-settings-setting-row" htmlFor="pref-theme-system">
                <span className="mm-settings-setting-text">
                  <span className="mm-settings-setting-title" id="theme-system-label">System (default)</span>
                  <span className="mm-settings-setting-desc" id="theme-system-desc">Follow your operating system light/dark setting.</span>
                </span>
                <span className="mm-settings-setting-control">
                  <input
                    id="pref-theme-system"
                    type="radio"
                    name="aae-theme"
                    checked={themePref === 'system'}
                    aria-labelledby="theme-system-label"
                    aria-describedby="theme-system-desc"
                    onChange={() => { setThemePref('system'); persistThemePreference('system') }}
                  />
                </span>
              </label>
            </div>
          </fieldset>
          <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
            <legend className="visually-hidden">Layout density</legend>
            <p className="field-label mm-settings-pref-legend">Layout density</p>
            <p className="mm-settings-lead">
              Compact mode tightens the channel list and composer so more fits in a small window. Use Quick go (Ctrl+K or Cmd+K) from home to jump without hunting sidebars. When the members column is
              hidden in a narrow window, open the roster from the Members control in the header or choose Members in Quick go. A full shortcut list is under Help.
            </p>
            <div className="mm-settings-stack">
            <label className="mm-settings-setting-row" htmlFor="pref-density-comfortable">
              <span className="mm-settings-setting-text">
                <span className="mm-settings-setting-title" id="density-comfortable-label">
                  Comfortable (default)
                </span>
                <span className="mm-settings-setting-desc" id="density-comfortable-desc">
                  Standard spacing in sidebars, lists, and the message composer.
                </span>
              </span>
              <span className="mm-settings-setting-control">
                <input
                  id="pref-density-comfortable"
                  type="radio"
                  name="aae-ui-density"
                  checked={uiDensity === 'comfortable'}
                  aria-labelledby="density-comfortable-label"
                  aria-describedby="density-comfortable-desc"
                  onChange={() => {
                    setUiDensity('comfortable')
                    persistUiDensity('comfortable')
                  }}
                />
              </span>
            </label>
            <label className="mm-settings-setting-row" htmlFor="pref-density-compact">
              <span className="mm-settings-setting-text">
                <span className="mm-settings-setting-title" id="density-compact-label">
                  Compact
                </span>
                <span className="mm-settings-setting-desc" id="density-compact-desc">
                  Denser rows and smaller vertical padding where supported.
                </span>
              </span>
              <span className="mm-settings-setting-control">
                <input
                  id="pref-density-compact"
                  type="radio"
                  name="aae-ui-density"
                  checked={uiDensity === 'compact'}
                  aria-labelledby="density-compact-label"
                  aria-describedby="density-compact-desc"
                  onChange={() => {
                    setUiDensity('compact')
                    persistUiDensity('compact')
                  }}
                />
              </span>
            </label>
            </div>
          </fieldset>
        </section>
      ) : null}
      {user && tab === 'updates' ? (
        <section>
          <div className="mm-update-panel">
            {/* Current version */}
            <div className="mm-update-current">
              <div className="mm-update-version-badge">
                <span className="mm-update-label">Current Version</span>
                <span className="mm-update-version">v{APP_VERSION}</span>
              </div>
            </div>

            {/* Update status */}
            {updateLoading ? (
              <div className="mm-update-status mm-update-checking">
                <Loader2 size={18} className="mm-spinner" />
                <span>Checking for updates…</span>
              </div>
            ) : updateError ? (
              <div className="mm-update-status mm-update-error">
                <AlertCircle size={18} />
                <span>{updateError}</span>
              </div>
            ) : updateInfo ? (
              <>
                {updateInfo.latest_version === `v${APP_VERSION}` || updateInfo.latest_version === APP_VERSION ? (
                  <div className="mm-update-status mm-update-uptodate">
                    <CheckCircle size={18} />
                    <span>You&apos;re up to date!</span>
                  </div>
                ) : (
                  <div className="mm-update-status mm-update-available">
                    <Download size={18} />
                    <span>New version available: <strong>{updateInfo.latest_version}</strong></span>
                  </div>
                )}

                <div className="mm-update-release">
                  <h4 className="mm-update-release-title">
                    {updateInfo.name || updateInfo.latest_version}
                  </h4>
                  {updateInfo.published_at && (
                    <p className="mm-update-release-date">
                      Released {new Date(updateInfo.published_at).toLocaleDateString(undefined, {
                        year: 'numeric', month: 'long', day: 'numeric'
                      })}
                    </p>
                  )}

                  {/* Release notes */}
                  {updateInfo.notes && (
                    <div className="mm-update-notes">
                      <h5>Release Notes</h5>
                      <div className="mm-update-notes-body">
                        {updateInfo.notes.split('\n').map((line, i) => (
                          <p key={i}>{line || '\u00A0'}</p>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Download assets */}
                  {updateInfo.assets.length > 0 && (
                    <div className="mm-update-assets">
                      <h5>Downloads</h5>
                      {updateInfo.assets.map(asset => (
                        <a key={asset.name} href={asset.download_url}
                          className="mm-update-asset-row"
                          target="_blank" rel="noopener noreferrer">
                          <Download size={14} />
                          <span className="mm-update-asset-name">{asset.name}</span>
                          <span className="mm-update-asset-size">
                            {asset.size > 1048576
                              ? `${(asset.size / 1048576).toFixed(1)} MB`
                              : `${(asset.size / 1024).toFixed(0)} KB`}
                          </span>
                          <ExternalLink size={12} style={{ opacity: 0.5 }} />
                        </a>
                      ))}
                    </div>
                  )}

                  {/* Link to GitHub release page */}
                  {updateInfo.url && (
                    <a href={updateInfo.url} target="_blank" rel="noopener noreferrer"
                      className="link-button" style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                      <ExternalLink size={13} /> View on GitHub
                    </a>
                  )}
                </div>
              </>
            ) : null}

            {/* Manual check button */}
            <button type="button" className="slack-button mm-update-check-btn"
              disabled={updateLoading}
              onClick={() => { setUpdateChecked(false); void checkForUpdates() }}>
              <RefreshCw size={14} />
              {updateLoading ? 'Checking…' : 'Check for Updates'}
            </button>
          </div>
        </section>
      ) : null}
      {user && tab === 'help' ? (
        <section>
          <div className="mm-settings-help-panel">
            <EmergencyContactPanel />
          </div>
          <h3 className="mm-settings-section-h">Keyboard shortcuts</h3>
          <dl className="mm-kbd-list">
            <div className="mm-kbd-row">
              <dt>
                <kbd className="mm-kbd">Ctrl</kbd> / <kbd className="mm-kbd">Cmd</kbd> + <kbd className="mm-kbd">K</kbd>
              </dt>
              <dd>Open or close Quick go (jump to channels, modules, settings, workspaces).</dd>
            </div>
            <div className="mm-kbd-row">
              <dt>
                <kbd className="mm-kbd">Ctrl</kbd> / <kbd className="mm-kbd">Cmd</kbd> + <kbd className="mm-kbd">,</kbd>
              </dt>
              <dd>Open Settings (from home).</dd>
            </div>
            <div className="mm-kbd-row">
              <dt>
                <kbd className="mm-kbd">Esc</kbd>
              </dt>
              <dd>
                Close Quick go, the members roster (narrow layout), Settings, IT contact, or other overlays; leave thread view; cancel editing; clear channel search when nothing else is open.
              </dd>
            </div>
            <div className="mm-kbd-row">
              <dt>Narrow layout</dt>
              <dd>
                When the members column is hidden, use the Members control in the chat header or open Quick go (Ctrl/Cmd+K) and pick Members to show the roster in a side panel.
              </dd>
            </div>
            <div className="mm-kbd-row">
              <dt>
                <kbd className="mm-kbd">Enter</kbd> / <kbd className="mm-kbd">Shift+Enter</kbd>
              </dt>
              <dd>In the message box: Enter sends, Shift+Enter starts a new line. Bold, italic, link, and lists use the toolbar hints on the composer.</dd>
            </div>
          </dl>
          <p className="mm-settings-lead">
            For password resets and access issues: use the verified IT contact panel above (live chat opens there only when IT is online and you have confirmed a one-time code). Quick reference:
          </p>
          <ul className="mm-settings-doc-list">
            {phone ? (
              <li>
                Published phone:{' '}
                <a href={`tel:${phone.replace(/\s/g, '')}`} className="link-button">
                  {phone}
                </a>
              </li>
            ) : (
              <li>Published phone: see your internal IT directory.</li>
            )}
            {email ? (
              <li>
                Published email:{' '}
                <a href={`mailto:${email}`} className="link-button">
                  {email}
                </a>
              </li>
            ) : null}
            {liveChat ? <li className="doc-muted">Live chat is linked from the panel above after verification when IT is online.</li> : null}
            <li>
              Need a new account?{' '}
              <Link href="/register" className="link-button">
                Request access
              </Link>
            </li>
          </ul>
        </section>
      ) : null}
      <div className="mm-settings-footer">
        <Link
          href="/workspaces"
          className="ghost-button"
          style={{ textAlign: 'center' }}
          onClick={() => {
            onClose?.()
          }}
        >
          Workspaces
        </Link>
        <button type="button" className="ghost-button mm-settings-sign-out" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </>
  )

  const tabPanel = (
    <div
      id={`mm-settings-panel-${tab}`}
      role="tabpanel"
      aria-labelledby={`mm-settings-tab-${tab}`}
      className="mm-settings-content"
    >
      <h2 className="mm-settings-content-title" id="mm-settings-panel-heading">
        {PANEL_TITLE[tab]}
      </h2>
      {body}
    </div>
  )

  if (isDrawer) {
    return (
      <div className="mm-settings-split">
        {tabNav}
        {tabPanel}
      </div>
    )
  }

  return (
    <>
      <h1 className="visually-hidden">Settings</h1>
      <div className="mm-settings-page-split">
        {tabNav}
        {tabPanel}
      </div>
    </>
  )
}

/** ── Profile edit sub-form ─────────────────────────────────────────────── */
function ProfileEditForm({ user, onSaved }: { user: MeUser; onSaved: (u: MeUser) => void }) {
  const [firstName, setFirstName] = useState(user.first_name)
  const [lastName, setLastName] = useState(user.last_name)
  const [nickname, setNickname] = useState(user.nickname)
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url || '')
  const [jobTitle, setJobTitle] = useState(user.job_title || '')
  const [phone, setPhone] = useState(user.phone || '')
  const [timezone, setTimezone] = useState(user.timezone || '')
  const [statusText, setStatusText] = useState(user.status_text || '')
  const [statusEmoji, setStatusEmoji] = useState(user.status_emoji || '')

  const [saving, setSaving] = useState(false)
  const [profileErr, setProfileErr] = useState('')
  const [profileOk, setProfileOk] = useState('')

  useEffect(() => {
    setFirstName(user.first_name)
    setLastName(user.last_name)
    setNickname(user.nickname)
    setAvatarUrl(user.avatar_url || '')
    setJobTitle(user.job_title || '')
    setPhone(user.phone || '')
    setTimezone(user.timezone || '')
    setStatusText(user.status_text || '')
    setStatusEmoji(user.status_emoji || '')
  }, [user])

  const dirty = firstName !== user.first_name || lastName !== user.last_name || nickname !== user.nickname || avatarUrl !== (user.avatar_url || '') || jobTitle !== (user.job_title || '') || phone !== (user.phone || '') || timezone !== (user.timezone || '') || statusText !== (user.status_text || '') || statusEmoji !== (user.status_emoji || '')

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!dirty || saving) return
    setSaving(true)
    setProfileErr('')
    setProfileOk('')
    try {
      const res = await apiFetch('/api/auth/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          first_name: firstName, 
          last_name: lastName, 
          nickname,
          avatar_url: avatarUrl,
          job_title: jobTitle,
          phone,
          timezone,
          status_text: statusText,
          status_emoji: statusEmoji
        })
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        setProfileErr(data.error || 'Save failed')
        return
      }
      const data = await res.json() as { user: MeUser }
      onSaved(data.user)
      setProfileOk('Profile updated.')
      setTimeout(() => setProfileOk(''), 3000)
    } catch {
      setProfileErr('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="mm-settings-profile-form" onSubmit={handleSave}>
      <div className="mm-settings-form-row">
        <label className="mm-settings-form-label" htmlFor="prof-first">First name</label>
        <input id="prof-first" className="mm-settings-input" value={firstName}
          onChange={e => setFirstName(e.target.value)} maxLength={128} autoComplete="given-name" />
      </div>
      <div className="mm-settings-form-row">
        <label className="mm-settings-form-label" htmlFor="prof-last">Last name</label>
        <input id="prof-last" className="mm-settings-input" value={lastName}
          onChange={e => setLastName(e.target.value)} maxLength={128} autoComplete="family-name" />
      </div>
      <div className="mm-settings-form-row">
        <label className="mm-settings-form-label" htmlFor="prof-nick">Nickname</label>
        <input id="prof-nick" className="mm-settings-input" value={nickname}
          onChange={e => setNickname(e.target.value)} maxLength={64} autoComplete="nickname"
          placeholder="Optional display name" />
      </div>
      <div className="mm-settings-form-row">
        <label className="mm-settings-form-label" htmlFor="prof-avatar">Avatar URL</label>
        <input id="prof-avatar" className="mm-settings-input" value={avatarUrl}
          onChange={e => setAvatarUrl(e.target.value)} maxLength={512} type="url"
          placeholder="https://..." />
      </div>
      <div className="mm-settings-form-row">
        <label className="mm-settings-form-label" htmlFor="prof-title">Job title</label>
        <input id="prof-title" className="mm-settings-input" value={jobTitle}
          onChange={e => setJobTitle(e.target.value)} maxLength={128} autoComplete="organization-title" />
      </div>
      <div className="mm-settings-form-row">
        <label className="mm-settings-form-label" htmlFor="prof-phone">Phone</label>
        <input id="prof-phone" className="mm-settings-input" value={phone}
          onChange={e => setPhone(e.target.value)} maxLength={32} autoComplete="tel" />
      </div>
      <div className="mm-settings-form-row">
        <label className="mm-settings-form-label" htmlFor="prof-tz">Timezone</label>
        <input id="prof-tz" className="mm-settings-input" value={timezone}
          onChange={e => setTimezone(e.target.value)} maxLength={64} placeholder="e.g. Asia/Bangkok" />
      </div>
      <div className="mm-settings-form-row">
        <label className="mm-settings-form-label" htmlFor="prof-status-emoji">Status Emoji</label>
        <input id="prof-status-emoji" className="mm-settings-input" value={statusEmoji}
          onChange={e => setStatusEmoji(e.target.value)} maxLength={8} placeholder="🌴" style={{ width: 60 }} />
      </div>
      <div className="mm-settings-form-row">
        <label className="mm-settings-form-label" htmlFor="prof-status-txt">Status Text</label>
        <input id="prof-status-txt" className="mm-settings-input" value={statusText}
          onChange={e => setStatusText(e.target.value)} maxLength={64} placeholder="On Vacation" />
      </div>
      {profileErr && (
        <div className="mm-auth-alert mm-auth-alert--error" role="alert" style={{ marginTop: 8 }}>
          <AlertCircle size={16} strokeWidth={2} aria-hidden />
          <span>{profileErr}</span>
        </div>
      )}
      {profileOk && (
        <div className="mm-auth-alert mm-auth-alert--success" role="status" style={{ marginTop: 8 }}>
          <CheckCircle size={16} strokeWidth={2} aria-hidden />
          <span>{profileOk}</span>
        </div>
      )}
      <div className="mm-settings-form-actions" style={{ marginTop: 12 }}>
        <button type="submit" className="slack-button" disabled={!dirty || saving}>
          {saving ? <><Loader2 size={14} className="mm-spinner" /> Saving…</> : 'Save changes'}
        </button>
      </div>
    </form>
  )
}
