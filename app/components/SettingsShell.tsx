'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, Eye, EyeOff, KeyRound, Loader2, Shield, User } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/apiClient'
import { EmergencyContactPanel } from '@/app/components/EmergencyContactPanel'
import { persistUiDensity, readUiDensity, type UiDensity } from '@/lib/uiDensity'

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
}

type SettingsTab = 'profile' | 'security' | 'notifications' | 'preferences' | 'help'

const PANEL_TITLE: Record<SettingsTab, string> = {
  profile: 'Profile',
  security: 'Security',
  notifications: 'Notifications',
  preferences: 'Preferences',
  help: 'Help and IT'
}

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'security', label: 'Security' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'help', label: 'Help' }
]

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
  // Security tab state
  const [curPassword, setCurPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurPw, setShowCurPw] = useState(false)
  const [showNewPw, setShowNewPw] = useState(false)
  const [pwChanging, setPwChanging] = useState(false)
  const [pwSuccess, setPwSuccess] = useState('')
  const [pwError, setPwError] = useState('')
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

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
    const i = SETTINGS_TABS.findIndex(t => t.id === tab)
    if (i < 0) return
    const id = window.requestAnimationFrame(() => {
      const btn = tabRefs.current[i]
      if (!btn) return
      const reduce =
        typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      btn.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: reduce ? 'auto' : 'smooth'
      })
    })
    return () => window.cancelAnimationFrame(id)
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

  const display = user
    ? [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || user.nickname || user.username
    : ''

  const profileAvatarLetter = user
    ? (display.trim().charAt(0) || user.username.charAt(0) || '').toUpperCase()
    : ''

  const isDrawer = variant === 'drawer'

  function onTabKeyNav(e: React.KeyboardEvent, index: number) {
    const n = SETTINGS_TABS.length
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault()
      const next = (index + 1) % n
      setTab(SETTINGS_TABS[next].id)
      tabRefs.current[next]?.focus()
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const next = (index - 1 + n) % n
      setTab(SETTINGS_TABS[next].id)
      tabRefs.current[next]?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      setTab(SETTINGS_TABS[0].id)
      tabRefs.current[0]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      setTab(SETTINGS_TABS[n - 1].id)
      tabRefs.current[n - 1]?.focus()
    }
  }

  const tabNav = (
    <nav role="tablist" aria-label="Settings sections" className="mm-settings-rail mm-settings-nav">
      {SETTINGS_TABS.map((t, i) => (
        <button
          key={t.id}
          ref={el => {
            tabRefs.current[i] = el
          }}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          aria-controls="mm-settings-tabpanel"
          id={`mm-settings-tab-${t.id}`}
          className={`mm-settings-nav-item${tab === t.id ? ' mm-settings-nav-item--active' : ''}`}
          onClick={() => setTab(t.id)}
          onKeyDown={e => onTabKeyNav(e, i)}
        >
          {t.label}
        </button>
      ))}
    </nav>
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
            Your name and email are managed by IT. If something is wrong, open a ticket or contact the service desk.
          </p>
          <div className="mm-settings-profile-top">
            <div className="mm-settings-avatar" aria-hidden>
              {profileAvatarLetter ? <span>{profileAvatarLetter}</span> : <User size={28} strokeWidth={2} aria-hidden />}
            </div>
            <div className="mm-settings-profile-names">
              <p className="mm-settings-profile-name">{display}</p>
              <p className="mm-settings-profile-handle">@{user.username}</p>
            </div>
          </div>
          <dl className="mm-settings-dl">
            <div className="mm-settings-dl-row">
              <dt className="mm-settings-dl-label">Display name</dt>
              <dd className="mm-settings-dl-value">{display}</dd>
            </div>
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
                <span className={`mm-settings-role-badge${user.platform_role === 'platform_admin' ? ' mm-settings-role-badge--admin' : ''}`}>
                  {user.platform_role === 'platform_admin' ? 'Administrator' : 'Member'}
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
            </div>
          )}
        </section>
      ) : null}
      {user && tab === 'preferences' ? (
        <section>
          <p className="mm-settings-lead">
            Appearance follows your system light or dark setting. Time zone for timestamps follows your device clock.
          </p>
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
      id="mm-settings-tabpanel"
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
