'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bell, BellOff, BellRing, Volume2, VolumeX, X } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'

interface Props {
  channelId: string
  channelName: string
  open: boolean
  onClose: () => void
}

type NotifLevel = 'default' | 'all' | 'mentions' | 'nothing'

const LEVEL_OPTIONS: { key: NotifLevel; label: string; desc: string; icon: React.ReactNode }[] = [
  { key: 'default', label: 'Default', desc: 'Use your global notification settings', icon: <Bell size={16} /> },
  { key: 'all', label: 'Every new message', desc: 'Get notified for all messages in this channel', icon: <BellRing size={16} /> },
  { key: 'mentions', label: 'Mentions only', desc: 'Only get notified when you are @mentioned', icon: <Volume2 size={16} /> },
  { key: 'nothing', label: 'Nothing', desc: 'Never get notifications from this channel', icon: <VolumeX size={16} /> },
]

export function ChannelNotifPrefsModal({ channelId, channelName, open, onClose }: Props) {
  const [level, setLevel] = useState<NotifLevel>('default')
  const [muted, setMuted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    if (!channelId) return
    const res = await apiFetch(`/api/channel-prefs?channel_id=${encodeURIComponent(channelId)}`)
    if (res.ok) {
      const data = (await res.json()) as { level: NotifLevel; muted: boolean }
      setLevel(data.level || 'default')
      setMuted(data.muted || false)
      setLoaded(true)
    }
  }, [channelId])

  useEffect(() => {
    if (open) {
      setLoaded(false)
      void load()
    }
  }, [open, load])

  async function save() {
    setSaving(true)
    await apiFetch('/api/channel-prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_id: channelId, level, muted })
    })
    setSaving(false)
    onClose()
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="mm-modal-overlay" role="presentation" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mm-modal channel-notif-modal" role="dialog" aria-modal="true"
        aria-label={`Notification preferences for ${channelName}`}
        onClick={e => e.stopPropagation()}>
        <div className="channel-notif-header">
          <h3>Notifications for #{channelName}</h3>
          <button type="button" className="mm-icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {!loaded ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--mm-muted)' }}>Loading…</div>
        ) : (
          <div className="channel-notif-body">
            <div className="channel-notif-section">
              <label className="channel-notif-section-label">Notification level</label>
              <div className="channel-notif-options">
                {LEVEL_OPTIONS.map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    className={`channel-notif-option${level === opt.key ? ' channel-notif-option--active' : ''}`}
                    onClick={() => setLevel(opt.key)}
                  >
                    <span className="channel-notif-option-icon">{opt.icon}</span>
                    <div>
                      <span className="channel-notif-option-label">{opt.label}</span>
                      <span className="channel-notif-option-desc">{opt.desc}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="channel-notif-section">
              <label className="channel-notif-section-label">Mute channel</label>
              <button
                type="button"
                className={`channel-notif-mute-btn${muted ? ' channel-notif-mute-btn--active' : ''}`}
                onClick={() => setMuted(m => !m)}
              >
                {muted ? <BellOff size={16} /> : <Bell size={16} />}
                <span>{muted ? 'Channel is muted' : 'Channel is not muted'}</span>
                <span className="channel-notif-mute-toggle">
                  <span className={`channel-notif-toggle-track${muted ? ' on' : ''}`}>
                    <span className="channel-notif-toggle-thumb" />
                  </span>
                </span>
              </button>
              <p className="channel-notif-mute-hint">
                Muted channels won&apos;t show unread indicators or desktop notifications.
              </p>
            </div>

            <div className="mm-modal-actions">
              <button type="button" className="ghost-button" onClick={onClose}>Cancel</button>
              <button type="button" className="slack-button" disabled={saving} onClick={() => void save()}>
                {saving ? 'Saving…' : 'Save preferences'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
