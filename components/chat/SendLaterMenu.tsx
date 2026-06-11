'use client'

import { useCallback, useState } from 'react'
import { Clock, ChevronDown, X } from 'lucide-react'

interface Props {
  channelId: string
  open: boolean
  onClose: () => void
  /** Called when the user picks a time — parent should get the message body. */
  onSchedule: (sendAt: number) => void
}

/**
 * Quick-pick presets for the "Send Later" UI (relative to current time).
 */
function getPresets(): { label: string; getTime: () => number }[] {
  const now = new Date()
  const today9am = new Date(now)
  today9am.setHours(9, 0, 0, 0)

  const tomorrow9am = new Date(now)
  tomorrow9am.setDate(tomorrow9am.getDate() + 1)
  tomorrow9am.setHours(9, 0, 0, 0)

  const nextMonday9am = new Date(now)
  const dayOfWeek = nextMonday9am.getDay()
  const daysUntilMonday = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 7 : 8 - dayOfWeek
  nextMonday9am.setDate(nextMonday9am.getDate() + daysUntilMonday)
  nextMonday9am.setHours(9, 0, 0, 0)

  const in30min = new Date(now.getTime() + 30 * 60_000)
  const in1h = new Date(now.getTime() + 60 * 60_000)
  const in2h = new Date(now.getTime() + 2 * 60 * 60_000)

  const fmt = (d: Date) => d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit'
  })

  return [
    { label: `In 30 minutes — ${fmt(in30min)}`, getTime: () => in30min.getTime() },
    { label: `In 1 hour — ${fmt(in1h)}`, getTime: () => in1h.getTime() },
    { label: `In 2 hours — ${fmt(in2h)}`, getTime: () => in2h.getTime() },
    ...(tomorrow9am.getTime() > now.getTime() ? [
      { label: `Tomorrow morning — ${fmt(tomorrow9am)}`, getTime: () => tomorrow9am.getTime() }
    ] : []),
    ...(nextMonday9am.getTime() > now.getTime() + 2 * 60 * 60_000 ? [
      { label: `Next Monday — ${fmt(nextMonday9am)}`, getTime: () => nextMonday9am.getTime() }
    ] : []),
  ]
}

export function SendLaterMenu({ open, onClose, onSchedule }: Props) {
  const [customMode, setCustomMode] = useState(false)
  const [customDate, setCustomDate] = useState('')
  const [customTime, setCustomTime] = useState('09:00')

  const handleCustomSubmit = useCallback(() => {
    if (!customDate || !customTime) return
    const dt = new Date(`${customDate}T${customTime}`)
    if (isNaN(dt.getTime()) || dt.getTime() <= Date.now()) return
    onSchedule(dt.getTime())
    onClose()
  }, [customDate, customTime, onSchedule, onClose])

  if (!open) return null

  return (
    <div className="send-later-menu" role="dialog" aria-modal="true" aria-label="Schedule message">
      <div className="send-later-header">
        <Clock size={16} />
        <span>Schedule for later</span>
        <button type="button" className="mm-icon-btn" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
      </div>

      {!customMode ? (
        <div className="send-later-presets">
          {getPresets().map((p, i) => (
            <button key={i} type="button" className="send-later-preset"
              onClick={() => { onSchedule(p.getTime()); onClose() }}>
              {p.label}
            </button>
          ))}
          <button type="button" className="send-later-preset send-later-preset--custom"
            onClick={() => setCustomMode(true)}>
            <Clock size={14} /> Custom date & time…
          </button>
        </div>
      ) : (
        <div className="send-later-custom">
          <label>
            <span>Date</span>
            <input type="date" value={customDate}
              min={new Date().toISOString().split('T')[0]}
              onChange={e => setCustomDate(e.target.value)} />
          </label>
          <label>
            <span>Time</span>
            <input type="time" value={customTime}
              onChange={e => setCustomTime(e.target.value)} />
          </label>
          <div className="send-later-custom-actions">
            <button type="button" className="ghost-button" onClick={() => setCustomMode(false)}>Back</button>
            <button type="button" className="slack-button" onClick={handleCustomSubmit}>
              Schedule
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Trigger button for the Composer — small chevron next to the send button.
 */
export function SendLaterTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="send-later-trigger" onClick={onClick}
      title="Schedule message" aria-label="Schedule message for later">
      <ChevronDown size={14} />
    </button>
  )
}
