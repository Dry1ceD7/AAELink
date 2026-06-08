'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api/apiClient'
import { toast } from '@/lib/ui/toast'

/* ── Types ────────────────────────────────────────────────────────────── */
interface DndSettings {
  enabled: boolean
  start_time: string
  end_time: string
  timezone: string
}

const DEFAULT_DND: DndSettings = {
  enabled: false,
  start_time: '22:00',
  end_time: '08:00',
  timezone: 'UTC',
}

function validTime(t: unknown, fallback: string): string {
  return typeof t === 'string' && /^\d{1,2}:\d{2}$/.test(t) ? t : fallback
}

/* ── Toggle (local copy — keeps this file self-contained) ─────────────── */
function DndToggle({ id, title, desc, checked, disabled, onChange }: {
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

/* ═══════════════════════════════════════════════════════════════════════
   Quiet hours (Do Not Disturb) — backed by /api/dnd
   ═══════════════════════════════════════════════════════════════════════ */
export function NotificationQuietHours({ effectiveTimezone }: { effectiveTimezone: string }) {
  const [dnd, setDnd] = useState<DndSettings>(DEFAULT_DND)
  const [loading, setLoading] = useState(true)

  // Load current DND schedule on open.
  useEffect(() => {
    void apiFetch('/api/dnd').then(r => (r.ok ? r.json() : null)).then((d: { dnd?: Partial<DndSettings> } | null) => {
      const s = d?.dnd
      if (s && typeof s === 'object') {
        setDnd({
          enabled: Boolean(s.enabled),
          start_time: validTime(s.start_time, DEFAULT_DND.start_time),
          end_time: validTime(s.end_time, DEFAULT_DND.end_time),
          timezone: typeof s.timezone === 'string' && s.timezone ? s.timezone : effectiveTimezone,
        })
      } else {
        setDnd(prev => ({ ...prev, timezone: effectiveTimezone }))
      }
    }).catch(() => { /* keep defaults */ }).finally(() => setLoading(false))
    // effectiveTimezone is stable for the lifetime of the modal; load once.
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist a patch to /api/dnd, toast on success/failure, reconcile on success.
  const persist = useCallback((patch: Partial<DndSettings>) => {
    const prev = dnd
    const next = { ...dnd, ...patch }
    setDnd(next)
    void apiFetch('/api/dnd', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: next.enabled,
        start_time: next.start_time,
        end_time: next.end_time,
        timezone: next.timezone || effectiveTimezone,
      }),
    }).then(r => (r.ok ? r.json() : Promise.reject(new Error('save_failed'))))
      .then((d: { dnd?: Partial<DndSettings> }) => {
        const s = d?.dnd
        if (s && typeof s === 'object') {
          setDnd({
            enabled: Boolean(s.enabled),
            start_time: validTime(s.start_time, next.start_time),
            end_time: validTime(s.end_time, next.end_time),
            timezone: typeof s.timezone === 'string' && s.timezone ? s.timezone : next.timezone,
          })
        }
        toast.success('Quiet hours updated')
      })
      .catch(() => {
        toast.error('Could not save quiet hours')
        setDnd(prev) // revert optimistic update to the captured pre-mutation state
      })
  }, [dnd, effectiveTimezone])

  return (
    <>
      <h3 className="pref-section-title" style={{ marginTop: 24 }}>Quiet hours</h3>
      <p className="pref-section-desc">
        Pause notifications on a daily schedule. Applies across all your devices.
      </p>
      <div className="pref-group">
        <DndToggle id="pref-dnd-enabled" title="Enable quiet hours"
          desc="Silence notifications every day between the times below."
          checked={dnd.enabled}
          disabled={loading}
          onChange={v => persist({ enabled: v })} />
        <div className="pref-row">
          <span className="pref-row-text">
            <span className="pref-row-title">Quiet hours window</span>
            <span className="pref-row-desc">
              Notifications are paused during these hours ({dnd.timezone || effectiveTimezone}).
            </span>
          </span>
          <div className="pref-time-range">
            <input type="time" value={dnd.start_time}
              disabled={loading}
              onChange={e => persist({ start_time: validTime(e.target.value, dnd.start_time) })} />
            <span>to</span>
            <input type="time" value={dnd.end_time}
              disabled={loading}
              onChange={e => persist({ end_time: validTime(e.target.value, dnd.end_time) })} />
          </div>
        </div>
      </div>
    </>
  )
}
