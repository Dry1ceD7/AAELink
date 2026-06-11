'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Bell, BellOff, Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import { toast } from '@/lib/ui/toast'

interface Props {
  channelId: string
  channelName: string
}

type Level = 'all' | 'mentions' | 'nothing'

const LEVELS: { value: Level; label: string; hint: string }[] = [
  { value: 'all', label: 'All messages', hint: 'Notify for every new message' },
  { value: 'mentions', label: 'Mentions only', hint: 'Only @mentions and keywords' },
  { value: 'nothing', label: 'Nothing', hint: 'No notifications from this channel' },
]

// A stored 'default' level behaves like "All messages" for this per-channel UI.
function normalizeLevel(raw: string): Level {
  if (raw === 'mentions' || raw === 'nothing') return raw
  return 'all'
}

/**
 * ChannelNotificationPrefsPopover — per-channel notification level control.
 * Trigger shows a Bell (active) or BellOff (muted / nothing) reflecting the
 * current preference. Opening loads the pref; changes persist via apiFetch.
 */
export const ChannelNotificationPrefsPopover = memo(function ChannelNotificationPrefsPopover({
  channelId,
  channelName,
}: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [level, setLevel] = useState<Level>('all')
  const [muted, setMuted] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch(`/api/channel-prefs?channel_id=${encodeURIComponent(channelId)}`)
      if (res.ok) {
        const data = await res.json()
        setLevel(normalizeLevel(String(data.level || 'default')))
        setMuted(Boolean(data.muted))
        setLoaded(true)
      } else {
        toast.error('Could not load notification settings')
      }
    } catch {
      toast.error('Could not load notification settings')
    } finally {
      setLoading(false)
    }
  }, [channelId])

  // Load once per open (and refresh if the channel changes while open).
  useEffect(() => {
    if (open) void load()
  }, [open, load])

  // Reset cached state when switching channels.
  useEffect(() => { setLoaded(false) }, [channelId])

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const persist = useCallback(async (nextLevel: Level, nextMuted: boolean) => {
    const prevLevel = level
    const prevMuted = muted
    setLevel(nextLevel)
    setMuted(nextMuted)
    setSaving(true)
    try {
      const res = await apiFetch('/api/channel-prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: channelId, level: nextLevel, muted: nextMuted }),
      })
      if (res.ok) {
        toast.success('Notification settings saved')
      } else {
        setLevel(prevLevel)
        setMuted(prevMuted)
        toast.error('Could not save notification settings')
      }
    } catch {
      setLevel(prevLevel)
      setMuted(prevMuted)
      toast.error('Could not save notification settings')
    } finally {
      setSaving(false)
    }
  }, [channelId, level, muted])

  const isSilent = muted || level === 'nothing'
  const TriggerIcon = isSilent ? BellOff : Bell

  return (
    <div className="channel-header-dropdown-wrap" ref={ref}>
      <button
        type="button"
        className={`mm-icon-btn${open ? ' mm-icon-btn--active' : ''}`}
        aria-label="Notification preferences"
        aria-expanded={open}
        title={isSilent ? 'Notifications muted' : 'Notification preferences'}
        onClick={() => setOpen(o => !o)}
      >
        <TriggerIcon size={16} aria-hidden />
      </button>

      {open && (
        <div className="channel-header-dropdown-menu" role="dialog" aria-label={`Notifications for ${channelName}`} style={{ minWidth: 240, padding: 0 }}>
          <div style={{ padding: '10px 14px 6px', fontSize: 12, fontWeight: 600, color: 'var(--mm-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
            Notifications
            {(loading || saving) && <Loader2 size={12} aria-hidden style={{ animation: 'spin 1s linear infinite' }} />}
          </div>

          {loading && !loaded ? (
            <div style={{ padding: '8px 14px 14px', fontSize: 13, color: 'var(--mm-muted)' }}>Loading…</div>
          ) : (
            <>
              <div role="radiogroup" aria-label="Notification level">
                {LEVELS.map(opt => {
                  const selected = level === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={saving}
                      className="channel-header-dropdown-item"
                      onClick={() => { if (!selected) void persist(opt.value, muted) }}
                      style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 2 }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: selected ? 600 : 400 }}>
                        <span aria-hidden style={{
                          width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                          border: `2px solid ${selected ? 'var(--mm-accent, #1264a3)' : 'var(--mm-border-subtle)'}`,
                          background: selected ? 'var(--mm-accent, #1264a3)' : 'transparent',
                          boxShadow: selected ? 'inset 0 0 0 2px var(--c-card)' : 'none',
                        }} />
                        {opt.label}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--mm-muted)', paddingLeft: 22 }}>{opt.hint}</span>
                    </button>
                  )
                })}
              </div>

              <hr className="channel-header-dropdown-sep" />

              <label className="channel-header-dropdown-item" style={{ cursor: saving ? 'default' : 'pointer' }}>
                <input
                  type="checkbox"
                  checked={muted}
                  disabled={saving}
                  onChange={(e) => void persist(level, e.target.checked)}
                  style={{ margin: 0, flexShrink: 0 }}
                />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span>Mute channel</span>
                  <span style={{ fontSize: 11, color: 'var(--mm-muted)' }}>Silence all notifications and badges</span>
                </span>
              </label>
            </>
          )}
        </div>
      )}
    </div>
  )
})
