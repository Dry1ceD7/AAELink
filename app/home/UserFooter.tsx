'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Settings, SmilePlus, ShieldAlert, LogOut, BellOff, CircleDot, ChevronUp } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import { toast } from '@/lib/ui/toast'
import { isPlatformAdmin } from '@/lib/comms/platformRole'

interface UserFooterProps {
  me: {
    id: string; username?: string; first_name?: string; last_name?: string
    platform_role?: string; nickname?: string; status_emoji?: string; status_text?: string
  } | null
  presenceStatus: string
  displayName: string
  onOpenPreferences: () => void
  onOpenCustomStatus: () => void
}

export function UserFooter({ me, presenceStatus, displayName, onOpenPreferences, onOpenCustomStatus }: UserFooterProps) {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [savingStatus, setSavingStatus] = useState(false)

  const customStatus = (me?.status_text || '').trim()
  const customEmoji = (me?.status_emoji || '').trim()

  async function setPresence(status: string) {
    setSavingStatus(true)
    try {
      const res = await apiFetch('/api/user-status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error('status_failed')
      setMenuOpen(false)
    } catch {
      toast.error('Could not update your status')
    } finally {
      setSavingStatus(false)
    }
  }

  const STATUS_OPTIONS = [
    { key: 'online', label: 'Online', color: 'var(--mm-online)' },
    { key: 'away', label: 'Away', color: 'var(--mm-away)' },
    { key: 'dnd', label: 'DND', color: '#d24b4e' },
    { key: 'offline', label: 'Offline', color: 'var(--mm-offline)' }
  ] as const

  return (
    <footer className="sidebar-user-footer" style={{ position: 'relative' }}>
      <button type="button" className="sidebar-user-btn" onClick={() => setMenuOpen(o => !o)}
        aria-haspopup="true" aria-expanded={menuOpen}>
        <div className="sidebar-user-avatar">
          {(me?.username || me?.first_name || 'U').slice(0, 1).toUpperCase()}
          <span className={`sidebar-user-presence presence--${presenceStatus}`} />
        </div>
        <div className="sidebar-user-info">
          <strong>{me ? displayName : 'Loading...'}</strong>
          <span className="sidebar-user-status">
            {customStatus
              ? <><span aria-hidden>{customEmoji || '💬'}</span> {customStatus}</>
              : presenceStatus === 'dnd'
                ? <><BellOff size={10} /> Do Not Disturb</>
                : <><CircleDot size={10} /> Active</>}
          </span>
        </div>
        <ChevronUp size={16} className="sidebar-user-chevron" />
      </button>

      {menuOpen && (
        <>
          <div className="ws-menu-backdrop" onClick={() => setMenuOpen(false)} />
          <div className="user-dropdown" role="menu" aria-label="User menu">
            <div className="ws-dropdown-header">
              <div className="ws-dropdown-avatar">{(me?.username || 'U').slice(0, 1).toUpperCase()}</div>
              <div>
                <strong className="ws-dropdown-name">{me ? displayName : 'User'}</strong>
                <span className="ws-dropdown-url">@{me?.username || ''}</span>
              </div>
            </div>
            <div className="ws-dropdown-divider" />
            <button type="button" className="ws-dropdown-item" onClick={() => { setMenuOpen(false); onOpenPreferences() }}>
              <Settings size={16} /> Profile &amp; preferences
            </button>
            <button type="button" className="ws-dropdown-item" onClick={() => { setMenuOpen(false); onOpenCustomStatus() }}>
              <SmilePlus size={16} /> Set a custom status
            </button>
            {me && isPlatformAdmin(me.platform_role) ? (
              <Link href="/admin" className="ws-dropdown-item" onClick={() => setMenuOpen(false)}>
                <ShieldAlert size={16} /> Administration
              </Link>
            ) : null}
            <div className="ws-dropdown-divider" />
            <div className="ws-dropdown-status-section" style={{ padding: '6px 12px' }}>
              <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--mm-muted)', letterSpacing: '0.5px' }}>Set status</span>
              <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                {STATUS_OPTIONS.map(s => (
                  <button key={s.key} type="button" disabled={savingStatus}
                    style={{
                      flex: 1, padding: '5px 0', border: '1px solid var(--mm-border-subtle)',
                      borderRadius: 8, background: presenceStatus === s.key ? 'rgba(128,128,128,0.12)' : 'transparent',
                      cursor: savingStatus ? 'default' : 'pointer',
                      fontSize: 11, fontWeight: 500, color: 'var(--fg)', opacity: savingStatus ? 0.6 : 1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                      transition: 'background 0.15s'
                    }}
                    onMouseEnter={e => { if (!savingStatus) (e.currentTarget as HTMLElement).style.background = 'rgba(128,128,128,0.1)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = presenceStatus === s.key ? 'rgba(128,128,128,0.12)' : 'transparent' }}
                    onClick={() => setPresence(s.key)}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="ws-dropdown-divider" />
            <button type="button" className="ws-dropdown-item ws-dropdown-item--danger"
              onClick={async () => { setMenuOpen(false); await apiFetch('/api/auth/logout', { method: 'POST' }); router.replace('/login') }}>
              <LogOut size={16} /> Sign out
            </button>
          </div>
        </>
      )}
    </footer>
  )
}
