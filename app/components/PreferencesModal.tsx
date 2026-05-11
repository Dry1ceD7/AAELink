'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  X, User, Bell, Palette, LayoutList, Globe, Accessibility, Wrench,
  Check, Monitor, Moon, Sun, Clock, Volume2, VolumeX, Search,
  ChevronRight, Loader2, AlertCircle, CheckCircle, Lock
} from 'lucide-react'
import {
  readPreferences, updatePreferences, getAutoTimezone, getEffectiveTimezone,
  type UserPreferences
} from '@/lib/userPreferences'
import { readThemePreference, persistThemePreference, type ThemePreference } from '@/lib/theme'
import { apiFetch } from '@/lib/apiClient'

/* ── Types ────────────────────────────────────────────────────────────── */
type PrefTab = 'profile' | 'notifications' | 'appearance' | 'sidebar' | 'language' | 'accessibility' | 'advanced'

interface MeUser {
  id: string; username: string; email: string; first_name: string; last_name: string
  nickname: string; platform_role?: string; avatar_url?: string; job_title?: string
  phone?: string; timezone?: string; status_text?: string; status_emoji?: string
  pronouns?: string; department?: string
}

const TABS: { id: PrefTab; label: string; icon: React.ReactNode }[] = [
  { id: 'profile',       label: 'Profile',             icon: <User size={16} /> },
  { id: 'notifications', label: 'Notifications',       icon: <Bell size={16} /> },
  { id: 'appearance',    label: 'Appearance',          icon: <Palette size={16} /> },
  { id: 'sidebar',       label: 'Sidebar',             icon: <LayoutList size={16} /> },
  { id: 'language',      label: 'Language & Region',   icon: <Globe size={16} /> },
  { id: 'accessibility', label: 'Accessibility',       icon: <Accessibility size={16} /> },
  { id: 'advanced',      label: 'Advanced',            icon: <Wrench size={16} /> },
]

/* ── Auto-save toast ──────────────────────────────────────────────────── */
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
function ToggleRow({ id, title, desc, checked, onChange }: {
  id: string; title: string; desc?: string; checked: boolean; onChange: (v: boolean) => void
}) {
  return (
    <label className="pref-row" htmlFor={id}>
      <span className="pref-row-text">
        <span className="pref-row-title">{title}</span>
        {desc && <span className="pref-row-desc">{desc}</span>}
      </span>
      <span className="pref-toggle-wrap">
        <input id={id} type="checkbox" className="pref-toggle" checked={checked}
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

  // ESC to close
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
          {/* Left nav */}
          <nav className="pref-nav" aria-label="Preference sections">
            {TABS.map(t => (
              <button key={t.id} type="button"
                className={`pref-nav-item${tab === t.id ? ' pref-nav-item--active' : ''}`}
                onClick={() => setTab(t.id)}>
                {t.icon}
                <span>{t.label}</span>
                <ChevronRight size={14} className="pref-nav-chevron" />
              </button>
            ))}
          </nav>

          {/* Content area */}
          <div className="pref-content">
            {tab === 'profile' && <ProfileTab user={user} loading={loading} onUserUpdated={setUser} flash={flash} />}
            {tab === 'notifications' && <NotificationsTab prefs={prefs} save={save} />}
            {tab === 'appearance' && <AppearanceTab prefs={prefs} save={save} theme={theme} setTheme={setTheme} />}
            {tab === 'sidebar' && <SidebarTab prefs={prefs} save={save} />}
            {tab === 'language' && <LanguageTab prefs={prefs} save={save} />}
            {tab === 'accessibility' && <AccessibilityTab prefs={prefs} save={save} />}
            {tab === 'advanced' && <AdvancedTab prefs={prefs} save={save} />}
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
        body: JSON.stringify({ first_name: firstName, last_name: lastName, nickname,
          job_title: jobTitle, phone, pronouns, department, status_emoji: statusEmoji, status_text: statusText })
      })
      if (!res.ok) { setErr('Save failed'); return }
      const data = await res.json() as { user: MeUser }
      onUserUpdated(data.user); flash()
    } catch { setErr('Network error') } finally { setSaving(false) }
  }

  if (loading) return <div className="pref-loading"><Loader2 size={20} className="spin" /> Loading profile…</div>
  if (!user) return <div className="pref-empty">Could not load profile.</div>

  const display = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.nickname || user.username
  const initial = (display || 'U').charAt(0).toUpperCase()

  return (
    <div className="pref-tab-content">
      <h3 className="pref-section-title">Your Profile</h3>
      <p className="pref-section-desc">This is how others see you. Username and email are managed by IT.</p>

      {/* Avatar + identity card */}
      <div className="pref-profile-card">
        <div className="pref-profile-avatar">
          {user.avatar_url ? <img src={user.avatar_url} alt={display} /> : <span>{initial}</span>}
        </div>
        <div className="pref-profile-identity">
          <p className="pref-profile-name">{display}</p>
          <p className="pref-profile-handle">@{user.username}</p>
          {user.email && <p className="pref-profile-email">{user.email}</p>}
        </div>
      </div>

      {/* Editable fields */}
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

      {/* Custom Status */}
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
   Tab: Notifications
   ═══════════════════════════════════════════════════════════════════════ */
function NotificationsTab({ prefs, save }: { prefs: UserPreferences; save: (p: Partial<UserPreferences>) => void }) {
  const [keywords, setKeywords] = useState(prefs.notifyKeywords.join(', '))

  return (
    <div className="pref-tab-content">
      <h3 className="pref-section-title">Notification Preferences</h3>
      <p className="pref-section-desc">Control when and how you receive alerts.</p>

      <div className="pref-group">
        <ToggleRow id="pref-mute-all" title="Mute all sounds" desc="Silence all notification sounds globally."
          checked={prefs.muteAllSounds} onChange={v => save({ muteAllSounds: v })} />
        <ToggleRow id="pref-typing" title="Show typing indicators" desc="See when others are typing in a channel."
          checked={prefs.showTypingIndicators} onChange={v => save({ showTypingIndicators: v })} />
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

      <h3 className="pref-section-title" style={{ marginTop: 24 }}>Keyword Alerts</h3>
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
   Tab: Appearance
   ═══════════════════════════════════════════════════════════════════════ */
function AppearanceTab({ prefs, save, theme, setTheme }: {
  prefs: UserPreferences; save: (p: Partial<UserPreferences>) => void
  theme: ThemePreference; setTheme: (t: ThemePreference) => void
}) {
  const themes: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
    { value: 'light',  label: 'Light',  icon: <Sun size={18} /> },
    { value: 'dark',   label: 'Dark',   icon: <Moon size={18} /> },
    { value: 'system', label: 'System', icon: <Monitor size={18} /> },
  ]

  return (
    <div className="pref-tab-content">
      <h3 className="pref-section-title">Theme</h3>
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

      <h3 className="pref-section-title" style={{ marginTop: 24 }}>Message Display</h3>
      <div className="pref-group">
        <SelectRow id="pref-density" title="Message density" value={prefs.messageDensity}
          desc="Cozy shows avatars and generous spacing. Compact is text-only."
          options={[{ value: 'cozy', label: 'Cozy (avatars)' }, { value: 'compact', label: 'Compact (dense)' }]}
          onChange={v => save({ messageDensity: v })} />
        <ToggleRow id="pref-avatars" title="Show avatars in timeline"
          checked={prefs.showAvatarsInTimeline} onChange={v => save({ showAvatarsInTimeline: v })} />
        <ToggleRow id="pref-link-preview" title="Show link previews"
          desc="Automatically unfurl URLs in messages."
          checked={prefs.showLinkPreviews} onChange={v => save({ showLinkPreviews: v })} />
      </div>

      <h3 className="pref-section-title" style={{ marginTop: 24 }}>Accent Color</h3>
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
   Tab: Sidebar
   ═══════════════════════════════════════════════════════════════════════ */
function SidebarTab({ prefs, save }: { prefs: UserPreferences; save: (p: Partial<UserPreferences>) => void }) {
  return (
    <div className="pref-tab-content">
      <h3 className="pref-section-title">Sidebar Preferences</h3>
      <div className="pref-group">
        <SelectRow id="pref-dm-sort" title="Direct message sorting" value={prefs.dmSortOrder}
          desc="Choose how DMs are ordered in the sidebar."
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

      <h3 className="pref-section-title" style={{ marginTop: 24 }}>Search</h3>
      <p className="pref-section-desc">
        <Search size={13} /> Exclude noisy channels from global search results.
      </p>
      <ToggleRow id="pref-link-previews-adv" title="Show link previews in messages"
        checked={prefs.showLinkPreviews} onChange={v => save({ showLinkPreviews: v })} />
    </div>
  )
}
