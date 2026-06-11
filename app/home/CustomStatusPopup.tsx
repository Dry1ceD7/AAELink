'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api/apiClient'
import { toast } from '@/lib/ui/toast'

interface CustomStatusPopupProps {
  open: boolean
  onClose: () => void
}

const PRESETS = [
  { emoji: '📅', text: 'In a meeting' },
  { emoji: '🚌', text: 'Commuting' },
  { emoji: '🤒', text: 'Out sick' },
  { emoji: '🌴', text: 'Vacationing' },
  { emoji: '🏠', text: 'Working remotely' },
  { emoji: '🔇', text: 'Focusing' },
] as const

const EMOJI_CYCLE = ['😊', '🏠', '🌴', '🤒', '🚀', '📅', '🎯', '💬', '🔇', '⛔']

// Clear-after options. minutes === null means "don't clear" (no expiry).
const EXPIRY_OPTIONS = [
  { key: '30m', label: '30 minutes', minutes: 30 },
  { key: '1h', label: '1 hour', minutes: 60 },
  { key: 'today', label: 'Today', minutes: -1 },
  { key: 'week', label: 'This week', minutes: -2 },
  { key: 'never', label: "Don't clear", minutes: null },
] as const

type ExpiryKey = (typeof EXPIRY_OPTIONS)[number]['key']

/** Resolve an expiry option to an absolute epoch-ms timestamp (0 = no expiry). */
function resolveExpiry(key: ExpiryKey): number {
  const opt = EXPIRY_OPTIONS.find(o => o.key === key)
  if (!opt || opt.minutes === null) return 0
  const now = new Date()
  if (opt.minutes === -1) {
    const end = new Date(now)
    end.setHours(23, 59, 59, 0)
    return end.getTime()
  }
  if (opt.minutes === -2) {
    const end = new Date(now)
    const daysUntilSunday = (7 - end.getDay()) % 7 || 7
    end.setDate(end.getDate() + daysUntilSunday)
    end.setHours(23, 59, 59, 0)
    return end.getTime()
  }
  return now.getTime() + opt.minutes * 60 * 1000
}

export function CustomStatusPopup({ open, onClose }: CustomStatusPopupProps) {
  const [emoji, setEmoji] = useState('')
  const [text, setText] = useState('')
  const [expiry, setExpiry] = useState<ExpiryKey>('never')
  const [pauseDnd, setPauseDnd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Reflect the current status when the popup opens.
  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    ;(async () => {
      try {
        const [meRes, dndRes] = await Promise.all([
          apiFetch('/api/auth/me'),
          apiFetch('/api/dnd'),
        ])
        if (!active) return
        if (meRes.ok) {
          const data = await meRes.json().catch(() => null) as { user?: { status_emoji?: string; status_text?: string } } | null
          setEmoji(data?.user?.status_emoji || '')
          setText(data?.user?.status_text || '')
        }
        if (dndRes.ok) {
          const data = await dndRes.json().catch(() => null) as { dnd?: { is_snoozed?: boolean } } | null
          setPauseDnd(Boolean(data?.dnd?.is_snoozed))
        }
      } catch {
        if (active) toast.error('Could not load your current status')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [open])

  if (!open) return null

  async function persistDnd(enable: boolean) {
    const body = enable
      ? { duration_minutes: 60 }
      : { action: 'end_snooze' as const }
    const res = await apiFetch('/api/dnd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error('dnd_failed')
  }

  async function save() {
    setSaving(true)
    try {
      const finalEmoji = emoji || (text ? '😊' : '')
      const expiresAt = resolveExpiry(expiry)
      // Persist custom status (with expiry + presence) via the canonical setter.
      const statusRes = await apiFetch('/api/user-status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status_text: text, status_emoji: finalEmoji, expires_at: expiresAt }),
      })
      if (!statusRes.ok) throw new Error('status_failed')
      // Mirror to the user profile so directory/cards reflect it.
      await apiFetch('/api/auth/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status_emoji: finalEmoji, status_text: text }),
      })
      await persistDnd(pauseDnd)
      toast.success('Status updated')
      onClose()
    } catch {
      toast.error('Could not update your status')
    } finally {
      setSaving(false)
    }
  }

  async function clear() {
    setSaving(true)
    try {
      const statusRes = await apiFetch('/api/user-status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status_text: '', status_emoji: '', expires_at: 0 }),
      })
      if (!statusRes.ok) throw new Error('status_failed')
      await apiFetch('/api/auth/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status_emoji: '', status_text: '' }),
      })
      if (pauseDnd) await persistDnd(false)
      setEmoji(''); setText(''); setPauseDnd(false); setExpiry('never')
      toast.success('Status cleared')
      onClose()
    } catch {
      toast.error('Could not clear your status')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="ws-menu-backdrop" onClick={onClose} />
      <div className="aae-auth-modal-overlay" onClick={onClose}>
        <div className="custom-status-popup" style={{
          position: 'relative', bottom: 'auto', left: 'auto', right: 'auto',
          maxWidth: 420, width: '100%', margin: '0 auto'
        }} onClick={e => e.stopPropagation()}>
          <h4>Set a status</h4>
          <div className="custom-status-row">
            <button type="button" className="custom-status-emoji-btn" disabled={loading || saving}
              onClick={() => {
                const idx = EMOJI_CYCLE.indexOf(emoji)
                setEmoji(EMOJI_CYCLE[(idx + 1) % EMOJI_CYCLE.length])
              }}>
              {emoji || '😊'}
            </button>
            <input type="text" className="custom-status-input"
              placeholder="What's your status?"
              value={text}
              onChange={e => setText(e.target.value)}
              maxLength={64}
              disabled={loading || saving}
              autoFocus />
          </div>
          <div className="custom-status-presets">
            {PRESETS.map(p => (
              <button key={p.text} type="button" className="custom-status-preset" disabled={loading || saving}
                onClick={() => { setEmoji(p.emoji); setText(p.text) }}>
                <span>{p.emoji}</span> {p.text}
              </button>
            ))}
          </div>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--mm-muted)', marginBottom: 4 }}>
            Clear after
          </label>
          <select value={expiry} onChange={e => setExpiry(e.target.value as ExpiryKey)}
            disabled={loading || saving}
            style={{
              width: '100%', padding: '7px 10px', marginBottom: 12,
              border: '1px solid var(--mm-border-subtle)', borderRadius: 8,
              font: 'inherit', fontSize: 13, background: 'var(--mm-main-bg)', color: 'var(--mm-text)'
            }}>
            {EXPIRY_OPTIONS.map(o => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
          <label style={{
            display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
            color: 'var(--mm-text)', marginBottom: 14, cursor: 'pointer'
          }}>
            <input type="checkbox" checked={pauseDnd} disabled={loading || saving}
              onChange={e => setPauseDnd(e.target.checked)} />
            Pause notifications (Do Not Disturb)
          </label>
          <div className="custom-status-actions">
            <button type="button" className="ghost-button" style={{ fontSize: 13 }}
              disabled={loading || saving}
              onClick={clear}>
              Clear status
            </button>
            <button type="button" className="slack-button" style={{ fontSize: 13 }}
              disabled={loading || saving}
              onClick={save}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
