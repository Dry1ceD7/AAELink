'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  X, User, Bell, Palette, Home, Globe, Accessibility, Wrench,
  Check, Monitor, Moon, Sun, Clock, Loader2, AlertCircle, CheckCircle, Lock,
  KeyRound, Eye, EyeOff, Phone, Headphones, MessageSquare, Image as ImageIcon,
} from 'lucide-react'
import {
  readPreferences, updatePreferences, getAutoTimezone, getEffectiveTimezone,
  type UserPreferences,
} from '@/lib/ui/userPreferences'
import { readThemePreference, persistThemePreference, type ThemePreference } from '@/lib/ui/theme'
import { PALETTES, readPalettePreference, persistPalettePreference } from '@/lib/ui/themePalette'
import { apiFetch } from '@/lib/api/apiClient'
import { TabList, TabPanel } from '@/components/a11y/TabList'
import { useConfirm } from '@/components/a11y'
import { EmergencyContactPanel } from '@/components/user/EmergencyContactPanel'
import { Monitor as MonitorIcon, Smartphone as SmartphoneIcon, Globe as GlobeIcon, Trash2 as Trash2Icon, Shield as ShieldIcon } from 'lucide-react'

/* ── Types ────────────────────────────────────────────────────────────── */
type PrefTab =
  | 'profile'
  | 'account'
  | 'notifications'
  | 'home'
  | 'themes'
  | 'messages_media'
  | 'mark_as_read'
  | 'audio_video'
  | 'language'
  | 'accessibility'
  | 'help'
  | 'advanced'

interface MeUser {
  id: string; username: string; email: string; first_name: string; last_name: string
  nickname: string; platform_role?: string; avatar_url?: string; job_title?: string
  phone?: string; timezone?: string; status_text?: string; status_emoji?: string
  pronouns?: string; department?: string
}

const TABS: { id: PrefTab; label: string; icon: React.ReactNode }[] = [
  { id: 'profile',         label: 'Profile',           icon: <User size={16} /> },
  { id: 'account',         label: 'Account & Security', icon: <KeyRound size={16} /> },
  { id: 'notifications',   label: 'Notifications',     icon: <Bell size={16} /> },
  { id: 'home',            label: 'Home',              icon: <Home size={16} /> },
  { id: 'themes',          label: 'Themes',            icon: <Palette size={16} /> },
  { id: 'messages_media',  label: 'Messages & Media',  icon: <MessageSquare size={16} /> },
  { id: 'mark_as_read',    label: 'Mark As Read',      icon: <CheckCircle size={16} /> },
  { id: 'audio_video',     label: 'Audio & Video',     icon: <Headphones size={16} /> },
  { id: 'language',        label: 'Language & Region', icon: <Globe size={16} /> },
  { id: 'accessibility',   label: 'Accessibility',     icon: <Accessibility size={16} /> },
  { id: 'help',            label: 'Help & IT',         icon: <Phone size={16} /> },
  { id: 'advanced',        label: 'Advanced',          icon: <Wrench size={16} /> },
]

/* ── Saved-toast hook ─────────────────────────────────────────────────── */
function useSavedToast() {
  const [show, setShow] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flash = useCallback(() => {
    setShow(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setShow(false), 1800)
  }, [])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return { show, flash }
}

/* ── Toggle Row ───────────────────────────────────────────────────────── */
function ToggleRow({ id, title, desc, checked, onChange, disabled }: {
  id: string; title: string; desc?: string; checked: boolean; disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="pref-row" htmlFor={id}>
      <span className="pref-row-text">
        <span className="pref-row-title">{title}</span>
        {desc && <span className="pref-row-desc">{desc}</span>}
      </span>
      <span className="pref-toggle-wrap">
        <input id={id} type="checkbox" className="pref-toggle" checked={checked}
          disabled={disabled}
          onChange={e => onChange(e.target.checked)} />
        <span className="pref-toggle-track" aria-hidden />
      </span>
    </label>
  )
}

/* ── Select Row ───────────────────────────────────────────────────────── */
function SelectRow<T extends string>({ id, title, desc, value, options, onChange }: {
  id: string; title: string; desc?: string; value: T
  options: { value: T; label: string }[]; onChange: (v: T) => void
}) {
  return (
    <label className="pref-row" htmlFor={id}>
      <span className="pref-row-text">
        <span className="pref-row-title">{title}</span>
        {desc && <span className="pref-row-desc">{desc}</span>}
      </span>
      <select id={id} className="pref-select" value={value}
        onChange={e => onChange(e.target.value as T)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

/* ── Radio group row (for Mark As Read) ───────────────────────────────── */
function RadioRow<T extends string>({ name, title, desc, value, options, onChange }: {
  name: string; title: string; desc?: string; value: T
  options: { value: T; label: string; desc?: string }[]; onChange: (v: T) => void
}) {
  return (
    <fieldset className="pref-row pref-row--column">
      <legend className="pref-row-text">
        <span className="pref-row-title">{title}</span>
        {desc && <span className="pref-row-desc">{desc}</span>}
      </legend>
      <div className="pref-radio-group">
        {options.map(o => (
          <label key={o.value} className={`pref-radio${value === o.value ? ' pref-radio--active' : ''}`}>
            <input type="radio" name={name} value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)} />
            <span className="pref-radio-body">
              <span className="pref-radio-label">{o.label}</span>
              {o.desc && <span className="pref-radio-desc">{o.desc}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}


/* ═══════════════════════════════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════════════════════════════ */
export const PreferencesModal = memo(function PreferencesModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<PrefTab>('profile')
  const [prefs, setPrefs] = useState<UserPreferences>(readPreferences)
  const [theme, setTheme] = useState<ThemePreference>(readThemePreference)
  const [user, setUser] = useState<MeUser | null>(null)
  const [loading, setLoading] = useState(true)
  const { show: saved, flash } = useSavedToast()
  const overlayRef = useRef<HTMLDivElement>(null)

  // Auto-save helper
  const save = useCallback((patch: Partial<UserPreferences>) => {
    const next = updatePreferences(patch)
    setPrefs(next)
    flash()
  }, [flash])

  // Load user profile
  useEffect(() => {
    apiFetch('/api/auth/me').then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.user) setUser(d.user as MeUser) })
      .finally(() => setLoading(false))
  }, [])

  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="pref-modal-overlay" ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) onClose() }}>
      <div className="pref-modal" role="dialog" aria-modal="true" aria-label="Preferences">
        {/* Header */}
        <header className="pref-modal-header">
          <h2>Preferences</h2>
          <div className="pref-modal-header-right">
            {saved && <span className="pref-saved-badge"><Check size={13} /> Saved</span>}
            <button type="button" className="mm-icon-btn" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="pref-modal-body">
          <nav className="pref-nav" aria-label="Preference sections">
            <TabList
              tabs={TABS.map(t => ({
                id: t.id,
                label: (
                  <>
                    {t.icon}
                    <span>{t.label}</span>
                  </>
                ),
              }))}
              value={tab}
              onChange={id => setTab(id as PrefTab)}
              ariaLabel="Preference sections"
              orientation="vertical"
              idPrefix="pref"
              className="pref-nav-tablist"
              tabClassName={(active) => `pref-nav-item${active ? ' pref-nav-item--active' : ''}`}
            />
          </nav>

          <div className="pref-content">
            <TabPanel tabId="profile" activeId={tab} idPrefix="pref" className="pref-panel">
              <ProfileTab user={user} loading={loading} onUserUpdated={setUser} flash={flash} />
            </TabPanel>
            <TabPanel tabId="account" activeId={tab} idPrefix="pref" className="pref-panel">
              <AccountTab />
            </TabPanel>
            <TabPanel tabId="notifications" activeId={tab} idPrefix="pref" className="pref-panel">
              <NotificationsTab prefs={prefs} save={save} />
            </TabPanel>
            <TabPanel tabId="home" activeId={tab} idPrefix="pref" className="pref-panel">
              <HomeTab prefs={prefs} save={save} />
            </TabPanel>
            <TabPanel tabId="themes" activeId={tab} idPrefix="pref" className="pref-panel">
              <ThemesTab prefs={prefs} save={save} theme={theme} setTheme={setTheme} />
            </TabPanel>
            <TabPanel tabId="messages_media" activeId={tab} idPrefix="pref" className="pref-panel">
              <MessagesMediaTab prefs={prefs} save={save} />
            </TabPanel>
            <TabPanel tabId="mark_as_read" activeId={tab} idPrefix="pref" className="pref-panel">
              <MarkAsReadTab prefs={prefs} save={save} />
            </TabPanel>
            <TabPanel tabId="audio_video" activeId={tab} idPrefix="pref" className="pref-panel">
              <AudioVideoTab prefs={prefs} save={save} />
            </TabPanel>
            <TabPanel tabId="language" activeId={tab} idPrefix="pref" className="pref-panel">
              <LanguageTab prefs={prefs} save={save} />
            </TabPanel>
            <TabPanel tabId="accessibility" activeId={tab} idPrefix="pref" className="pref-panel">
              <AccessibilityTab prefs={prefs} save={save} />
            </TabPanel>
            <TabPanel tabId="help" activeId={tab} idPrefix="pref" className="pref-panel">
              <HelpTab />
            </TabPanel>
            <TabPanel tabId="advanced" activeId={tab} idPrefix="pref" className="pref-panel">
              <AdvancedTab prefs={prefs} save={save} />
            </TabPanel>
          </div>
        </div>
      </div>
    </div>
  )
})


/* ═══════════════════════════════════════════════════════════════════════
   Tab: Profile
   ═══════════════════════════════════════════════════════════════════════ */
function ProfileTab({ user, loading, onUserUpdated, flash }: {
  user: MeUser | null; loading: boolean; onUserUpdated: (u: MeUser) => void; flash: () => void
}) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [nickname, setNickname] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [phone, setPhone] = useState('')
  const [pronouns, setPronouns] = useState('')
  const [department, setDepartment] = useState('')
  const [statusEmoji, setStatusEmoji] = useState('')
  const [statusText, setStatusText] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [avatarUploading, setAvatarUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!user) return
    setFirstName(user.first_name); setLastName(user.last_name); setNickname(user.nickname)
    setJobTitle(user.job_title || ''); setPhone(user.phone || '')
    setPronouns(user.pronouns || ''); setDepartment(user.department || '')
    setStatusEmoji(user.status_emoji || ''); setStatusText(user.status_text || '')
  }, [user])

  const handleSave = async () => {
    if (!user || saving) return
    setSaving(true); setErr('')
    try {
      const res = await apiFetch('/api/auth/me', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: firstName, last_name: lastName, nickname,
          job_title: jobTitle, phone, pronouns, department,
          status_emoji: statusEmoji, status_text: statusText,
        }),
      })
      if (!res.ok) { setErr('Save failed'); return }
      const data = await res.json() as { user: MeUser }
      onUserUpdated(data.user); flash()
    } catch { setErr('Network error') } finally { setSaving(false) }
  }

  const handleAvatarUpload = async (file: File) => {
    if (!file || !user) return
    if (file.size > 5 * 1024 * 1024) { setErr('Image must be under 5MB'); return }
    setAvatarUploading(true)
    setErr('')
    try {
      // Upload via existing /api/files/upload
      const fd = new FormData()
      fd.append('file', file)
      fd.append('purpose', 'avatar')
      const upRes = await apiFetch('/api/files/upload', { method: 'POST', body: fd })
      if (!upRes.ok) { setErr('Upload failed'); return }
      const upData = await upRes.json() as { url?: string; download_url?: string }
      const url = upData.url || upData.download_url
      if (!url) { setErr('Upload returned no URL'); return }
      // Persist on user
      const meRes = await apiFetch('/api/auth/me', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar_url: url }),
      })
      if (!meRes.ok) { setErr('Could not save avatar'); return }
      const meData = await meRes.json() as { user: MeUser }
      onUserUpdated(meData.user); flash()
    } catch { setErr('Network error') } finally { setAvatarUploading(false) }
  }

  if (loading) return <div className="pref-loading"><Loader2 size={20} className="spin" /> Loading profile…</div>
  if (!user) return <div className="pref-empty">Could not load profile.</div>

  const display = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.nickname || user.username
  const initial = (display || 'U').charAt(0).toUpperCase()

  return (
    <div className="pref-tab-content">
      <h3 className="pref-section-title">Your Profile</h3>
      <p className="pref-section-desc">This is how others see you. Username and email are managed by IT.</p>

      <div className="pref-profile-card">
        <div className="pref-profile-avatar" style={{ position: 'relative' }}>
          {user.avatar_url ? <img src={user.avatar_url} alt={display} /> : <span>{initial}</span>}
          <button
            type="button"
            className="pref-avatar-edit"
            onClick={() => fileRef.current?.click()}
            disabled={avatarUploading}
            aria-label="Change profile photo"
            style={{
              position: 'absolute', right: -4, bottom: -4,
              width: 28, height: 28, borderRadius: '50%',
              background: 'var(--mm-bg, #fff)', border: '1px solid var(--mm-border, rgba(0,0,0,0.12))',
              display: 'grid', placeItems: 'center', cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
            }}
          >
            {avatarUploading ? <Loader2 size={12} className="spin" /> : <ImageIcon size={12} />}
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden
            onChange={e => { const f = e.target.files?.[0]; if (f) void handleAvatarUpload(f); e.target.value = '' }} />
        </div>
        <div className="pref-profile-identity">
          <p className="pref-profile-name">{display}</p>
          <p className="pref-profile-handle">@{user.username}</p>
          {user.email && <p className="pref-profile-email">{user.email}</p>}
        </div>
      </div>

      <div className="pref-form-grid">
        <div className="pref-field">
          <label htmlFor="pf-first">First name</label>
          <input id="pf-first" value={firstName} onChange={e => setFirstName(e.target.value)} maxLength={128} />
        </div>
        <div className="pref-field">
          <label htmlFor="pf-last">Last name</label>
          <input id="pf-last" value={lastName} onChange={e => setLastName(e.target.value)} maxLength={128} />
        </div>
        <div className="pref-field">
          <label htmlFor="pf-nick">Display name</label>
          <input id="pf-nick" value={nickname} onChange={e => setNickname(e.target.value)} maxLength={64} placeholder="Optional nickname" />
        </div>
        <div className="pref-field">
          <label htmlFor="pf-pronouns">Pronouns</label>
          <input id="pf-pronouns" value={pronouns} onChange={e => setPronouns(e.target.value)} maxLength={32} placeholder="e.g. he/him, she/her, they/them" />
        </div>
        <div className="pref-field">
          <label htmlFor="pf-title">Job title <span className="pref-field-lock"><Lock size={10} style={{ display: 'inline', verticalAlign: 'middle' }} /> Admin</span></label>
          <input id="pf-title" value={jobTitle} onChange={e => setJobTitle(e.target.value)} maxLength={128} />
        </div>
        <div className="pref-field">
          <label htmlFor="pf-dept">Department <span className="pref-field-lock"><Lock size={10} style={{ display: 'inline', verticalAlign: 'middle' }} /> Admin</span></label>
          <input id="pf-dept" value={department} onChange={e => setDepartment(e.target.value)} maxLength={128} placeholder="e.g. Engineering" />
        </div>
        <div className="pref-field">
          <label htmlFor="pf-phone">Phone</label>
          <input id="pf-phone" value={phone} onChange={e => setPhone(e.target.value)} maxLength={32} type="tel" />
        </div>
      </div>

      <h3 className="pref-section-title" style={{ marginTop: 24 }}>Custom Status</h3>
      <div className="pref-status-row">
        <input className="pref-status-emoji" value={statusEmoji} onChange={e => setStatusEmoji(e.target.value)} maxLength={8} placeholder="😀" />
        <input className="pref-status-text" value={statusText} onChange={e => setStatusText(e.target.value)} maxLength={100} placeholder="What's your status?" />
      </div>

      {err && <div className="pref-error"><AlertCircle size={14} /> {err}</div>}

      <button type="button" className="pref-save-btn" onClick={() => void handleSave()} disabled={saving}>
        {saving ? <><Loader2 size={14} className="spin" /> Saving…</> : <><CheckCircle size={14} /> Save Profile</>}
      </button>
    </div>
  )
}


/* ═══════════════════════════════════════════════════════════════════════
   Tab: Account & Security (password + sessions)
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Map the change-password route's `password_policy_violation` detail codes
 * (lib/auth/passwordPolicy PasswordViolation + 'password_reused') to a single
 * human-readable message. Falls back to a generic policy message for unknown
 * codes or an empty detail array.
 */
const PW_VIOLATION_MESSAGES: Record<string, string> = {
  too_short: 'be longer (minimum length not met)',
  require_upper: 'include an uppercase letter',
  require_lower: 'include a lowercase letter',
  require_digit: 'include a number',
  require_symbol: 'include a symbol',
  contains_username: 'not contain your username',
  contains_email: 'not contain your email address',
  password_reused: 'not match a recently used password',
}
function describePasswordViolation(detail?: string[]): string {
  const parts = (detail ?? [])
    .map(code => PW_VIOLATION_MESSAGES[code])
    .filter((m): m is string => Boolean(m))
  if (parts.length === 0) return 'New password does not meet the password policy.'
  return `New password must ${parts.join('; ')}.`
}

function AccountTab() {
  const [curPassword, setCurPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurPw, setShowCurPw] = useState(false)
  const [showNewPw, setShowNewPw] = useState(false)
  const [pwChanging, setPwChanging] = useState(false)
  const [pwSuccess, setPwSuccess] = useState('')
  const [pwError, setPwError] = useState('')

  const onChangePassword = async (e: React.FormEvent) => {
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
        body: JSON.stringify({ current_password: curPassword, new_password: newPassword }),
      })
      if (res.ok) {
        setPwSuccess('Password changed successfully.')
        setCurPassword(''); setNewPassword(''); setConfirmPassword('')
        setShowCurPw(false); setShowNewPw(false)
        setTimeout(() => setPwSuccess(''), 3000)
      } else {
        let j: { error?: string; detail?: string[] } = {}
        try { j = (await res.json()) as { error?: string; detail?: string[] } } catch { /* ignore */ }
        if (j.error === 'invalid_credentials') setPwError('Current password is incorrect.')
        else if (j.error === 'password_policy_violation') setPwError(describePasswordViolation(j.detail))
        else if (j.error === 'password_same') setPwError('New password must be different from current password.')
        else setPwError('Could not change password. Try again or contact IT.')
      }
    } catch {
      setPwError('Network error. Check your connection.')
    } finally {
      setPwChanging(false)
    }
  }

  return (
    <div className="pref-tab-content">
      <h3 className="pref-section-title">Change Password</h3>
      <p className="pref-section-desc">
        Choose a strong password with at least 8 characters. After changing your password you will remain signed in.
      </p>

      <form className="pref-pw-form" onSubmit={onChangePassword}>
        <div className="pref-field">
          <label htmlFor="pref-cur-pw">Current password</label>
          <div className="pref-pw-wrap">
            <input
              id="pref-cur-pw" className="slack-input"
              type={showCurPw ? 'text' : 'password'}
              value={curPassword} onChange={e => setCurPassword(e.target.value)}
              autoComplete="current-password" required
            />
            <button type="button" className="pref-pw-toggle"
              aria-label={showCurPw ? 'Hide password' : 'Show password'}
              onClick={() => setShowCurPw(v => !v)}>
              {showCurPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <div className="pref-field">
          <label htmlFor="pref-new-pw">New password</label>
          <div className="pref-pw-wrap">
            <input
              id="pref-new-pw" className="slack-input"
              type={showNewPw ? 'text' : 'password'}
              value={newPassword} onChange={e => setNewPassword(e.target.value)}
              autoComplete="new-password" minLength={8} required
            />
            <button type="button" className="pref-pw-toggle"
              aria-label={showNewPw ? 'Hide password' : 'Show password'}
              onClick={() => setShowNewPw(v => !v)}>
              {showNewPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <div className="pref-field">
          <label htmlFor="pref-confirm-pw">Confirm new password</label>
          <input
            id="pref-confirm-pw" className="slack-input"
            type="password"
            value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
            autoComplete="new-password" minLength={8} required
          />
        </div>

        {pwError && <div className="pref-error" role="alert"><AlertCircle size={14} /> {pwError}</div>}
        {pwSuccess && <div className="pref-success" role="status"><CheckCircle size={14} /> {pwSuccess}</div>}

        <button type="submit" className="pref-save-btn" disabled={pwChanging}>
          {pwChanging ? <><Loader2 size={14} className="spin" /> Changing…</> : <><KeyRound size={14} /> Change password</>}
        </button>
      </form>

      <h3 className="pref-section-title" style={{ marginTop: 24 }}>Active Sessions</h3>
      <p className="pref-section-desc">Devices currently signed in to your account. Revoke any you don't recognize.</p>
      <InlineSessionsList />
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   Tab: Notifications
   ═══════════════════════════════════════════════════════════════════════ */
function NotificationsTab({ prefs, save }: { prefs: UserPreferences; save: (p: Partial<UserPreferences>) => void }) {
  const [keywords, setKeywords] = useState(prefs.notifyKeywords.join(', '))
  // Server-side notification flags
  const [serverFlags, setServerFlags] = useState<{
    mentions_enabled: boolean
    ticket_activity_enabled: boolean
    system_notifications_enabled: boolean
    digest_frequency: 'off' | 'daily' | 'weekly'
  }>({
    mentions_enabled: true, ticket_activity_enabled: true, system_notifications_enabled: true,
    digest_frequency: 'off',
  })
  const [serverLoading, setServerLoading] = useState(true)

  const normalizeDigest = (v: unknown): 'off' | 'daily' | 'weekly' =>
    v === 'daily' || v === 'weekly' ? v : 'off'

  useEffect(() => {
    void apiFetch('/api/auth/notification-prefs').then(r => r.ok ? r.json() : null).then(d => {
      if (d && typeof d === 'object') {
        setServerFlags({
          mentions_enabled: Boolean(d.mentions_enabled ?? true),
          ticket_activity_enabled: Boolean(d.ticket_activity_enabled ?? true),
          system_notifications_enabled: Boolean(d.system_notifications_enabled ?? true),
          digest_frequency: normalizeDigest(d.digest_frequency),
        })
      }
    }).finally(() => setServerLoading(false))
  }, [])

  const saveServerFlag = useCallback((patch: Partial<typeof serverFlags>) => {
    setServerFlags(prev => ({ ...prev, ...patch }))
    void apiFetch('/api/auth/notification-prefs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(r => r.ok ? r.json() : null).then(d => {
      if (d && typeof d === 'object') {
        setServerFlags({
          mentions_enabled: Boolean(d.mentions_enabled ?? true),
          ticket_activity_enabled: Boolean(d.ticket_activity_enabled ?? true),
          system_notifications_enabled: Boolean(d.system_notifications_enabled ?? true),
          digest_frequency: normalizeDigest(d.digest_frequency),
        })
      }
    })
  }, [])

  return (
    <div className="pref-tab-content">
      <h3 className="pref-section-title">How to notify you</h3>
      <p className="pref-section-desc">Pick which events trigger a notification.</p>

      <div className="pref-group">
        <ToggleRow id="pref-mentions" title="Mentions and direct messages"
          desc="Get notified when someone @-mentions you or sends a DM."
          checked={serverFlags.mentions_enabled}
          disabled={serverLoading}
          onChange={v => saveServerFlag({ mentions_enabled: v })} />
        <ToggleRow id="pref-ticket-activity" title="Ticket activity"
          desc="New comments, status changes, or assignments on your tickets."
          checked={serverFlags.ticket_activity_enabled}
          disabled={serverLoading}
          onChange={v => saveServerFlag({ ticket_activity_enabled: v })} />
        <ToggleRow id="pref-system" title="System notifications"
          desc="Maintenance, deployment, and platform-level alerts."
          checked={serverFlags.system_notifications_enabled}
          disabled={serverLoading}
          onChange={v => saveServerFlag({ system_notifications_enabled: v })} />
        <div className="pref-row">
          <div className="pref-row-text">
            <label htmlFor="pref-digest" className="pref-row-title">Email digest</label>
            <p className="pref-row-desc">Get a summary email of unread mentions and DMs you missed.</p>
          </div>
          <select id="pref-digest" className="pref-select"
            value={serverFlags.digest_frequency}
            disabled={serverLoading}
            onChange={e => saveServerFlag({ digest_frequency: normalizeDigest(e.target.value) })}>
            <option value="off">Off</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </div>
        <ToggleRow id="pref-mute-all" title="Mute all sounds"
          desc="Silence all notification sounds globally."
          checked={prefs.muteAllSounds} onChange={v => save({ muteAllSounds: v })} />
        <ToggleRow id="pref-typing" title="Show typing indicators"
          desc="See when others are typing in a channel."
          checked={prefs.showTypingIndicators} onChange={v => save({ showTypingIndicators: v })} />
      </div>

      <h3 className="pref-section-title" style={{ marginTop: 24 }}>Also notify you about</h3>
      <p className="pref-section-desc">Extra events on top of mentions and DMs.</p>
      <div className="pref-group">
        <ToggleRow id="pref-thread-replies" title="Replies in threads I follow"
          desc="Pings when someone replies to a thread you've participated in."
          checked={prefs.notifyThreadReplies} onChange={v => save({ notifyThreadReplies: v })} />
        <ToggleRow id="pref-huddle-start" title="A huddle starts in my channels or DMs"
          desc="Get a popup when someone starts a huddle in a channel you belong to."
          checked={prefs.notifyHuddleStart} onChange={v => save({ notifyHuddleStart: v })} />
        <ToggleRow id="pref-vip-dnd" title="VIPs message me while paused"
          desc="Override Do Not Disturb for messages from VIP contacts."
          checked={prefs.notifyVipDuringDnd} onChange={v => save({ notifyVipDuringDnd: v })} />
      </div>

      <h3 className="pref-section-title" style={{ marginTop: 24 }}>Notification Schedule</h3>
      <div className="pref-group">
        <ToggleRow id="pref-weekday" title="Only allow notifications on weekdays"
          desc="Suppress notifications on Saturday and Sunday."
          checked={prefs.notifyOnlyWeekdays} onChange={v => save({ notifyOnlyWeekdays: v })} />
        <div className="pref-row">
          <span className="pref-row-text">
            <span className="pref-row-title">Active hours</span>
            <span className="pref-row-desc">Only receive notifications during these hours.</span>
          </span>
          <div className="pref-time-range">
            <input type="time" value={prefs.notifyScheduleStart}
              onChange={e => save({ notifyScheduleStart: e.target.value })} />
            <span>to</span>
            <input type="time" value={prefs.notifyScheduleEnd}
              onChange={e => save({ notifyScheduleEnd: e.target.value })} />
          </div>
        </div>
      </div>

      <h3 className="pref-section-title" style={{ marginTop: 24 }}>Channel Keywords</h3>
      <p className="pref-section-desc">Get notified when these words are mentioned (comma-separated).</p>
      <textarea className="pref-textarea" value={keywords} rows={3}
        placeholder="e.g. deploy, production, urgent"
        onChange={e => setKeywords(e.target.value)}
        onBlur={() => {
          const kw = keywords.split(',').map(k => k.trim()).filter(Boolean)
          save({ notifyKeywords: kw })
        }} />
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   Tab: Home (was Sidebar)
   ═══════════════════════════════════════════════════════════════════════ */
function HomeTab({ prefs, save }: { prefs: UserPreferences; save: (p: Partial<UserPreferences>) => void }) {
  return (
    <div className="pref-tab-content">
      <h3 className="pref-section-title">Sidebar</h3>
      <p className="pref-section-desc">Choose what appears in your sidebar and how it's organized.</p>
      <div className="pref-group">
        <SelectRow id="pref-dm-sort" title="Sort direct messages by" value={prefs.dmSortOrder}
          desc="Most recent shows people you've DM'd recently first."
          options={[{ value: 'recent', label: 'Most recent' }, { value: 'alpha', label: 'Alphabetical' }]}
          onChange={v => save({ dmSortOrder: v })} />
        <ToggleRow id="pref-ch-preview" title="Show channel preview text"
          desc="Display the last message snippet below channel names."
          checked={prefs.showChannelPreviews} onChange={v => save({ showChannelPreviews: v })} />
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   Tab: Themes
   ═══════════════════════════════════════════════════════════════════════ */
function ThemesTab({ prefs, save, theme, setTheme }: {
  prefs: UserPreferences; save: (p: Partial<UserPreferences>) => void
  theme: ThemePreference; setTheme: (t: ThemePreference) => void
}) {
  const themes: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
    { value: 'light',  label: 'Light',  icon: <Sun size={18} /> },
    { value: 'dark',   label: 'Dark',   icon: <Moon size={18} /> },
    { value: 'system', label: 'System', icon: <Monitor size={18} /> },
  ]
  const [palette, setPaletteState] = useState<string>(() => readPalettePreference())
  const choosePalette = (key: string) => {
    setPaletteState(key)
    persistPalettePreference(key)
  }

  return (
    <div className="pref-tab-content">
      <h3 className="pref-section-title">Mode</h3>
      <p className="pref-section-desc">Pick how AAELink looks. The system option follows your OS appearance.</p>
      <div className="pref-theme-cards">
        {themes.map(t => (
          <button key={t.value} type="button"
            className={`pref-theme-card${theme === t.value ? ' pref-theme-card--active' : ''}`}
            onClick={() => { setTheme(t.value); persistThemePreference(t.value) }}>
            {t.icon}
            <span>{t.label}</span>
            {theme === t.value && <Check size={14} className="pref-theme-check" />}
          </button>
        ))}
      </div>

      <h3 className="pref-section-title" style={{ marginTop: 24 }}>Sidebar palette</h3>
      <p className="pref-section-desc">
        A named palette recolors the sidebar and workspace rail without changing the timeline mode. Mix and match.
      </p>
      <div className="pref-palette-grid">
        {PALETTES.map(p => {
          const isActive = palette === p.key
          return (
            <button
              key={p.key}
              type="button"
              className={`pref-palette-card${isActive ? ' pref-palette-card--active' : ''}`}
              onClick={() => choosePalette(p.key)}
              aria-pressed={isActive}
            >
              <span
                className="pref-palette-swatch"
                aria-hidden="true"
                style={{
                  background: p.vars['--mm-sidebar-bg'],
                  color: p.vars['--mm-sidebar-text-active'],
                }}
              >
                <span style={{ background: p.vars['--mm-sidebar-active-bg'] }} />
                <span style={{ background: p.vars['--mm-sidebar-mention-bg'] }} />
                <span style={{ background: p.vars['--aae-link'] }} />
              </span>
              <span className="pref-palette-label">{p.label}</span>
              {isActive && <Check size={12} className="pref-palette-check" />}
            </button>
          )
        })}
      </div>

      <h3 className="pref-section-title" style={{ marginTop: 24 }}>Accent color</h3>
      <p className="pref-section-desc">The accent color is used for active states, links, and brand chrome.</p>
      <div className="pref-accent-row">
        <input type="color" value={prefs.accentColor} className="pref-color-picker"
          onChange={e => save({ accentColor: e.target.value })} />
        <input type="text" value={prefs.accentColor} className="pref-color-hex"
          maxLength={7} pattern="#[0-9a-fA-F]{6}"
          onChange={e => { if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) save({ accentColor: e.target.value }) }} />
        <button type="button" className="pref-color-reset" onClick={() => save({ accentColor: '#1C58D9' })}>
          Reset
        </button>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   Tab: Messages & Media
   ═══════════════════════════════════════════════════════════════════════ */
function MessagesMediaTab({ prefs, save }: { prefs: UserPreferences; save: (p: Partial<UserPreferences>) => void }) {
  return (
    <div className="pref-tab-content">
      <h3 className="pref-section-title">Message Display</h3>
      <div className="pref-group">
        <SelectRow id="pref-density" title="Message density" value={prefs.messageDensity}
          desc="Cozy shows avatars and generous spacing. Compact tightens the sidebar, channel header, composer, and message timeline."
          options={[{ value: 'cozy', label: 'Cozy (default)' }, { value: 'compact', label: 'Compact (dense)' }]}
          onChange={v => save({ messageDensity: v })} />
        <ToggleRow id="pref-avatars" title="Show avatars in timeline"
          desc="Hide avatars for a denser feed."
          checked={prefs.showAvatarsInTimeline} onChange={v => save({ showAvatarsInTimeline: v })} />
      </div>

      <h3 className="pref-section-title" style={{ marginTop: 24 }}>Media & Links</h3>
      <div className="pref-group">
        <ToggleRow id="pref-link-preview" title="Show link previews"
          desc="Automatically unfurl URLs in messages."
          checked={prefs.showLinkPreviews} onChange={v => save({ showLinkPreviews: v })} />
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   Tab: Mark As Read (Slack parity §10)
   ═══════════════════════════════════════════════════════════════════════ */
function MarkAsReadTab({ prefs, save }: { prefs: UserPreferences; save: (p: Partial<UserPreferences>) => void }) {
  return (
    <div className="pref-tab-content">
      <h3 className="pref-section-title">When opening a channel</h3>
      <RadioRow
        name="pref-mark-as-read-start"
        title="Where should AAELink land?"
        desc="Decide what message you see first when you click into a channel."
        value={prefs.markAsReadStart}
        options={[
          { value: 'oldest_unread', label: 'Start at the oldest unread', desc: 'Slack default. Catch up from where you left off.' },
          { value: 'most_recent', label: 'Start where I left off', desc: 'Resume the last viewed scroll position.' },
          { value: 'newest', label: 'Always jump to newest', desc: 'Skip past unreads — show only the latest activity.' },
        ]}
        onChange={v => save({ markAsReadStart: v })}
      />

      <h3 className="pref-section-title" style={{ marginTop: 24 }}>When pressing Esc</h3>
      <div className="pref-group">
        <ToggleRow id="pref-esc-marks-all" title="Esc marks all unreads as read"
          desc="Press Esc anywhere in the app to clear every unread badge in one go."
          checked={prefs.escMarksAllRead} onChange={v => save({ escMarksAllRead: v })} />
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   Tab: Audio & Video (Slack parity §10)
   ═══════════════════════════════════════════════════════════════════════ */
interface MediaDevice { deviceId: string; label: string; kind: 'audioinput' | 'audiooutput' | 'videoinput' }

function AudioVideoTab({ prefs, save }: { prefs: UserPreferences; save: (p: Partial<UserPreferences>) => void }) {
  const [mics, setMics] = useState<MediaDevice[]>([])
  const [cams, setCams] = useState<MediaDevice[]>([])
  const [speakers, setSpeakers] = useState<MediaDevice[]>([])
  const [denied, setDenied] = useState(false)
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState<'mic' | 'speaker' | null>(null)

  const enumerate = useCallback(async () => {
    setLoading(true)
    try {
      // Best-effort labels: ask for permission so deviceLabels are populated.
      try { await navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t => t.stop())) }
      catch { setDenied(true) }
      const list = await navigator.mediaDevices.enumerateDevices()
      setMics(list.filter(d => d.kind === 'audioinput').map(d => ({ deviceId: d.deviceId, label: d.label || 'Microphone', kind: 'audioinput' as const })))
      setCams(list.filter(d => d.kind === 'videoinput').map(d => ({ deviceId: d.deviceId, label: d.label || 'Camera', kind: 'videoinput' as const })))
      setSpeakers(list.filter(d => d.kind === 'audiooutput').map(d => ({ deviceId: d.deviceId, label: d.label || 'Speaker', kind: 'audiooutput' as const })))
    } catch { /* unsupported */ } finally { setLoading(false) }
  }, [])

  useEffect(() => { void enumerate() }, [enumerate])

  const testMic = async () => {
    setTesting('mic')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: prefs.preferredMicId ? { deviceId: { exact: prefs.preferredMicId } } : true,
      })
      // Just hold for ~3s to confirm it works, then stop.
      setTimeout(() => { stream.getTracks().forEach(t => t.stop()); setTesting(null) }, 3000)
    } catch { setTesting(null) }
  }

  const testSpeaker = () => {
    setTesting('speaker')
    try {
      const audio = new Audio('/notifications/default.mp3')
      audio.play().catch(() => { /* ignore */ })
      audio.onended = () => setTesting(null)
      setTimeout(() => setTesting(null), 2000)
    } catch { setTesting(null) }
  }

  return (
    <div className="pref-tab-content">
      <h3 className="pref-section-title">Audio</h3>
      <p className="pref-section-desc">Picks the default mic and speaker the next time you join a huddle or call.</p>

      {denied ? (
        <div className="pref-error" role="alert">
          <AlertCircle size={14} /> Microphone permission denied. Grant access in your browser to choose specific devices.
          <button type="button" className="ghost-button" onClick={() => void enumerate()} style={{ marginLeft: 12 }}>
            Retry
          </button>
        </div>
      ) : null}

      <div className="pref-group">
        <SelectRow id="pref-mic" title="Microphone" value={prefs.preferredMicId || ''}
          desc={loading ? 'Enumerating devices…' : `${mics.length} available`}
          options={[{ value: '', label: 'System default' }, ...mics.map(d => ({ value: d.deviceId, label: d.label }))]}
          onChange={v => save({ preferredMicId: v })} />
        <SelectRow id="pref-speaker" title="Speaker" value={prefs.preferredSpeakerId || ''}
          desc={loading ? 'Enumerating devices…' : `${speakers.length} available`}
          options={[{ value: '', label: 'System default' }, ...speakers.map(d => ({ value: d.deviceId, label: d.label }))]}
          onChange={v => save({ preferredSpeakerId: v })} />
        <ToggleRow id="pref-noise" title="Noise suppression"
          desc="Filter background noise from your microphone using your browser's built-in suppressor."
          checked={prefs.noiseSuppression} onChange={v => save({ noiseSuppression: v })} />
        <ToggleRow id="pref-mute-on-join" title="Join huddles muted"
          desc="Always start with your microphone muted."
          checked={prefs.defaultMuteOnJoin} onChange={v => save({ defaultMuteOnJoin: v })} />
      </div>

      <div className="pref-group" style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" className="ghost-button" disabled={testing === 'mic'} onClick={() => void testMic()}>
          {testing === 'mic' ? <><Loader2 size={12} className="spin" /> Listening…</> : 'Test microphone'}
        </button>
        <button type="button" className="ghost-button" disabled={testing === 'speaker'} onClick={() => testSpeaker()}>
          {testing === 'speaker' ? <><Loader2 size={12} className="spin" /> Playing…</> : 'Test speaker'}
        </button>
      </div>

      <h3 className="pref-section-title" style={{ marginTop: 24 }}>Video</h3>
      <div className="pref-group">
        <SelectRow id="pref-camera" title="Camera" value={prefs.preferredCameraId || ''}
          desc={loading ? 'Enumerating devices…' : `${cams.length} available`}
          options={[{ value: '', label: 'System default' }, ...cams.map(d => ({ value: d.deviceId, label: d.label }))]}
          onChange={v => save({ preferredCameraId: v })} />
        <ToggleRow id="pref-camera-on-join" title="Start huddles with camera on"
          desc="Turn camera on automatically when you join a video huddle."
          checked={prefs.defaultCameraOnJoin} onChange={v => save({ defaultCameraOnJoin: v })} />
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   Tab: Language & Region
   ═══════════════════════════════════════════════════════════════════════ */
function LanguageTab({ prefs, save }: { prefs: UserPreferences; save: (p: Partial<UserPreferences>) => void }) {
  const autoTz = getAutoTimezone()
  const effectiveTz = getEffectiveTimezone(prefs)
  const now = new Date()
  const hour12 = prefs.timeFormat === '12h'
  let preview = ''
  try { preview = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12, timeZone: effectiveTz }) } catch { preview = now.toLocaleTimeString() }

  return (
    <div className="pref-tab-content">
      <h3 className="pref-section-title">Time & Date</h3>
      <div className="pref-group">
        <SelectRow id="pref-time-fmt" title="Time format" value={prefs.timeFormat}
          options={[{ value: '12h', label: '12-hour (1:30 PM)' }, { value: '24h', label: '24-hour (13:30)' }]}
          onChange={v => save({ timeFormat: v })} />
        <SelectRow id="pref-date-fmt" title="Date format" value={prefs.dateFormat}
          options={[
            { value: 'auto', label: 'Auto (system locale)' },
            { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
            { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
            { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
          ]}
          onChange={v => save({ dateFormat: v })} />
      </div>

      <h3 className="pref-section-title" style={{ marginTop: 24 }}>Timezone</h3>
      <p className="pref-section-desc">
        <Clock size={13} /> Detected: <strong>{autoTz}</strong>
      </p>
      <div className="pref-field" style={{ maxWidth: 320 }}>
        <label htmlFor="pref-tz-override">Override timezone</label>
        <input id="pref-tz-override" value={prefs.timezoneOverride}
          onChange={e => save({ timezoneOverride: e.target.value })}
          placeholder="Leave empty to use detected timezone" />
      </div>
      <p className="pref-preview-time">Preview: <strong>{preview}</strong> ({effectiveTz})</p>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   Tab: Accessibility
   ═══════════════════════════════════════════════════════════════════════ */
function AccessibilityTab({ prefs, save }: { prefs: UserPreferences; save: (p: Partial<UserPreferences>) => void }) {
  return (
    <div className="pref-tab-content">
      <h3 className="pref-section-title">Accessibility</h3>
      <p className="pref-section-desc">Adjust the interface to suit your needs.</p>
      <div className="pref-group">
        <div className="pref-row">
          <span className="pref-row-text">
            <span className="pref-row-title">UI Scale</span>
            <span className="pref-row-desc">Zoom the entire interface ({prefs.uiScale}%).</span>
          </span>
          <div className="pref-scale-wrap">
            <span className="pref-scale-label">A</span>
            <input type="range" min={80} max={150} step={5} value={prefs.uiScale}
              className="pref-scale-slider" onChange={e => save({ uiScale: Number(e.target.value) })} />
            <span className="pref-scale-label pref-scale-label--large">A</span>
          </div>
        </div>
        <ToggleRow id="pref-high-contrast" title="High contrast mode"
          desc="Increase contrast for better readability."
          checked={prefs.highContrast} onChange={v => save({ highContrast: v })} />
        <ToggleRow id="pref-reduce-motion" title="Reduce motion"
          desc="Minimize animations and transitions."
          checked={prefs.reduceMotion} onChange={v => save({ reduceMotion: v })} />
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   Tab: Help & IT (was a separate page)
   ═══════════════════════════════════════════════════════════════════════ */
function HelpTab() {
  return (
    <div className="pref-tab-content">
      <h3 className="pref-section-title">Help &amp; IT Support</h3>
      <p className="pref-section-desc">
        For password resets, MFA issues, or account recovery, contact IT through the verified channel below. Live chat opens only when IT is online and you've confirmed a one-time code.
      </p>
      <EmergencyContactPanel />

      <h3 className="pref-section-title" style={{ marginTop: 24 }}>Quick Reference</h3>
      <ul className="pref-doc-list">
        <li><strong>Cmd / Ctrl + K</strong> — quick switcher</li>
        <li><strong>Cmd / Ctrl + ,</strong> — preferences (this modal)</li>
        <li><strong>Cmd / Ctrl + /</strong> — keyboard shortcuts</li>
        <li><strong>Cmd / Ctrl + Shift + F</strong> — global search</li>
        <li><strong>Cmd / Ctrl + .</strong> — toggle channel info</li>
        <li><strong>Cmd / Ctrl + 1..9</strong> — switch workspace</li>
      </ul>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   Tab: Advanced
   ═══════════════════════════════════════════════════════════════════════ */
function AdvancedTab({ prefs, save }: { prefs: UserPreferences; save: (p: Partial<UserPreferences>) => void }) {
  return (
    <div className="pref-tab-content">
      <h3 className="pref-section-title">Messaging</h3>
      <div className="pref-group">
        <SelectRow id="pref-send-key" title="Send messages with"
          desc="Choose whether Enter or Ctrl/Cmd+Enter sends your message."
          value={prefs.sendOnEnter ? 'enter' : 'ctrl-enter'}
          options={[{ value: 'enter', label: 'Enter' }, { value: 'ctrl-enter', label: 'Ctrl/Cmd + Enter' }]}
          onChange={v => save({ sendOnEnter: v === 'enter' })} />
        <ToggleRow id="pref-spellcheck" title="Spellcheck"
          desc="Enable browser spellcheck in the message composer."
          checked={prefs.spellcheck} onChange={v => save({ spellcheck: v })} />
        <ToggleRow id="pref-md-preview" title="Markdown preview"
          desc="Show a rendered preview below the composer while typing."
          checked={prefs.markdownPreview} onChange={v => save({ markdownPreview: v })} />
      </div>
    </div>
  )
}


/* ═══════════════════════════════════════════════════════════════════════
   Inline session manager (slim variant for Preferences > Account)
   ═══════════════════════════════════════════════════════════════════════ */
interface SessionRow {
  id: string
  user_agent: string
  ip_address: string
  created_at: number
  expires_at: number
  last_active_at: number
  is_current: boolean
}

function parseDevice(ua: string): { icon: 'desktop' | 'mobile' | 'web'; label: string } {
  const lower = (ua || '').toLowerCase()
  if (/electron/i.test(lower)) return { icon: 'desktop', label: 'AAELink Desktop' }
  if (/mobile|android|iphone|ipad/i.test(lower)) return { icon: 'mobile', label: 'Mobile Browser' }
  if (/edg/i.test(lower)) return { icon: 'web', label: 'Edge' }
  if (/chrome/i.test(lower)) return { icon: 'web', label: 'Chrome' }
  if (/firefox/i.test(lower)) return { icon: 'web', label: 'Firefox' }
  if (/safari/i.test(lower) && !/chrome/i.test(lower)) return { icon: 'web', label: 'Safari' }
  return { icon: 'web', label: 'Web Browser' }
}

function relTime(ts: number): string {
  if (!ts) return 'Never'
  const diff = Date.now() - ts
  if (diff < 60_000) return 'Just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function DeviceGlyph({ type }: { type: 'desktop' | 'mobile' | 'web' }) {
  if (type === 'desktop') return <MonitorIcon size={18} />
  if (type === 'mobile') return <SmartphoneIcon size={18} />
  return <GlobeIcon size={18} />
}

function InlineSessionsList() {
  const { confirm, confirmDialog } = useConfirm()
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [revokingAll, setRevokingAll] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await apiFetch('/api/auth/sessions')
    if (res.ok) {
      const data = (await res.json()) as { sessions: SessionRow[] }
      setSessions(data.sessions || [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  async function revoke(id: string) {
    if (!(await confirm({ title: 'Revoke session', message: 'Revoke this session? The device will be logged out immediately.', danger: true, confirmLabel: 'Revoke' }))) return
    setRevoking(id)
    const res = await apiFetch(`/api/auth/sessions?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    setRevoking(null)
    if (res.ok) void load()
  }

  async function revokeAll() {
    if (!(await confirm({ title: 'Revoke all other sessions', message: 'Revoke ALL other sessions? Every other device will be logged out.', danger: true, confirmLabel: 'Revoke all' }))) return
    setRevokingAll(true)
    const others = sessions.filter(s => !s.is_current)
    for (const s of others) {
      await apiFetch(`/api/auth/sessions?id=${encodeURIComponent(s.id)}`, { method: 'DELETE' })
    }
    setRevokingAll(false)
    void load()
  }

  if (loading) {
    return (
      <p className="pref-loading"><Loader2 size={16} className="spin" /> Loading sessions…</p>
    )
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--mm-muted)' }}>
          <ShieldIcon size={13} style={{ marginRight: 6, verticalAlign: '-2px' }} />
          {sessions.length} active session{sessions.length === 1 ? '' : 's'}
        </span>
        {sessions.filter(s => !s.is_current).length > 0 && (
          <button type="button" className="ghost-button ghost-button--danger"
            style={{ fontSize: 12, padding: '4px 10px' }}
            disabled={revokingAll} onClick={() => void revokeAll()}>
            {revokingAll ? <><Loader2 size={12} className="spin" /> Revoking…</> : 'Revoke all others'}
          </button>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sessions.map(s => {
          const dev = parseDevice(s.user_agent)
          return (
            <div key={s.id} style={{
              padding: 12, borderRadius: 10,
              border: s.is_current ? '2px solid var(--mm-online, #2bac76)' : '1px solid var(--mm-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <DeviceGlyph type={dev.icon} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {dev.label}
                    {s.is_current && (
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 6, background: '#2bac7620', color: '#2bac76', fontWeight: 700 }}>
                        THIS DEVICE
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--mm-muted)' }}>
                    {s.ip_address || 'Unknown IP'} · Last active {relTime(s.last_active_at || s.created_at)}
                  </div>
                </div>
              </div>
              {!s.is_current && (
                <button type="button" className="mm-icon-btn" title="Revoke session"
                  style={{ color: '#d24b4e', flexShrink: 0 }}
                  disabled={revoking === s.id}
                  onClick={() => void revoke(s.id)}>
                  {revoking === s.id ? <Loader2 size={14} className="spin" /> : <Trash2Icon size={14} />}
                </button>
              )}
            </div>
          )
        })}
        {sessions.length === 0 && (
          <p style={{ textAlign: 'center', color: 'var(--mm-muted)', fontSize: 13, padding: 16 }}>
            No active sessions found.
          </p>
        )}
      </div>
      {confirmDialog}
    </>
  )
}
