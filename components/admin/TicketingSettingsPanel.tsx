'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clock, AlertCircle, Plus, RefreshCw, Calendar } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import { DataTable, SkeletonStack, Surface } from '@/components/primitives'
import {
  type TicketPriority,
  type TicketStatus,
  type BusinessHoursWindow,
  DEFAULT_BUSINESS_HOURS,
} from '@/lib/enterprise/slaEngine'

/* ───────────────────────────── Types ──────────────────────────────────── */

interface Workspace {
  id: string
  name: string
  display_name: string
}

interface SlaPolicy {
  id: string
  workspace_id: string
  name: string
  priority: TicketPriority
  first_response_ms: number
  resolution_ms: number
  pause_on_status: TicketStatus[]
  business_hours_id: string | null
  created_at: number
}

interface BusinessHours {
  id: string
  workspace_id: string
  name: string
  timezone: string
  schedule: BusinessHoursWindow[]
  holidays: string[]
  created_at: number
}

const PRIORITIES: TicketPriority[] = ['critical', 'high', 'medium', 'low']
const PAUSE_STATES: TicketStatus[] = ['pending', 'open', 'in_progress', 'resolved', 'closed']
const HOUR_MS = 3_600_000
const WEEKDAYS: Array<{ wday: number; label: string }> = [
  { wday: 1, label: 'Mon' }, { wday: 2, label: 'Tue' }, { wday: 3, label: 'Wed' },
  { wday: 4, label: 'Thu' }, { wday: 5, label: 'Fri' }, { wday: 6, label: 'Sat' }, { wday: 7, label: 'Sun' },
]

function fmtHours(ms: number): string {
  const h = ms / HOUR_MS
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`
}

function minToHHMM(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function hhmmToMin(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return 0
  return Math.min(1440, Math.max(0, Number(m[1]) * 60 + Number(m[2])))
}

/* ─────────────────────────── Component ────────────────────────────────── */

export function TicketingSettingsPanel() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [policies, setPolicies] = useState<SlaPolicy[]>([])
  const [hoursList, setHoursList] = useState<BusinessHours[]>([])

  // Load workspaces once
  useEffect(() => {
    void (async () => {
      setLoading(true)
      try {
        const res = await apiFetch('/api/workspaces')
        if (res.ok) {
          const data = (await res.json()) as { teams?: Workspace[] }
          const ws = data.teams || []
          setWorkspaces(ws)
          if (ws.length && !workspaceId) setWorkspaceId(ws[0].id)
        }
      } finally {
        setLoading(false)
      }
    })()
    // run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadAll = useCallback(async () => {
    if (!workspaceId) return
    setError('')
    try {
      const [pRes, hRes] = await Promise.all([
        apiFetch(`/api/sla/policies?workspace_id=${encodeURIComponent(workspaceId)}`),
        apiFetch(`/api/business-hours?workspace_id=${encodeURIComponent(workspaceId)}`),
      ])
      if (pRes.ok) {
        const d = (await pRes.json()) as { policies?: SlaPolicy[] }
        setPolicies(d.policies || [])
      }
      if (hRes.ok) {
        const d = (await hRes.json()) as { business_hours?: BusinessHours[] }
        setHoursList(d.business_hours || [])
      }
      if (!pRes.ok && !hRes.ok) setError('Could not load settings.')
    } catch {
      setError('Network error.')
    }
  }, [workspaceId])

  useEffect(() => { void loadAll() }, [loadAll])

  /* ─────────── SLA Policies ─────────── */

  const policyByPriority = useMemo(() => {
    const map: Partial<Record<TicketPriority, SlaPolicy>> = {}
    for (const p of policies) map[p.priority] = p
    return map
  }, [policies])

  const createPolicy = useCallback(
    async (priority: TicketPriority, firstHours: number, resolutionHours: number, pauseOn: TicketStatus[], bhId: string | null) => {
      if (!workspaceId) return
      setBusy(true); setError('')
      try {
        const res = await apiFetch('/api/sla/policies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspace_id: workspaceId,
            name: `${priority} policy`,
            priority,
            first_response_ms: firstHours * HOUR_MS,
            resolution_ms: resolutionHours * HOUR_MS,
            pause_on_status: pauseOn,
            business_hours_id: bhId,
          }),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          setError(d.error || 'Could not save policy.')
          return
        }
        await loadAll()
      } finally {
        setBusy(false)
      }
    }, [workspaceId, loadAll]
  )

  /* ─────────── Business Hours ─────────── */

  const [bhForm, setBhForm] = useState<{
    name: string
    timezone: string
    schedule: BusinessHoursWindow[]
    holidays: string
  }>({
    name: 'Default',
    timezone: 'UTC',
    schedule: [...DEFAULT_BUSINESS_HOURS],
    holidays: '',
  })

  const createBusinessHours = useCallback(async () => {
    if (!workspaceId) return
    setBusy(true); setError('')
    try {
      const holidays = bhForm.holidays
        .split(/[,\s]+/)
        .map(s => s.trim())
        .filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s))
      const res = await apiFetch('/api/business-hours', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          name: bhForm.name,
          timezone: bhForm.timezone,
          schedule: bhForm.schedule,
          holidays,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || 'Could not save business hours.')
        return
      }
      setBhForm({
        name: 'Default',
        timezone: 'UTC',
        schedule: [...DEFAULT_BUSINESS_HOURS],
        holidays: '',
      })
      await loadAll()
    } finally {
      setBusy(false)
    }
  }, [workspaceId, bhForm, loadAll])

  const toggleScheduleDay = (wday: number) => {
    setBhForm(prev => {
      const has = prev.schedule.some(w => w.wday === wday)
      if (has) {
        return { ...prev, schedule: prev.schedule.filter(w => w.wday !== wday) }
      }
      return {
        ...prev,
        schedule: [...prev.schedule, { wday, start: 9 * 60, end: 17 * 60 }].sort((a, b) => a.wday - b.wday),
      }
    })
  }

  const setScheduleTime = (wday: number, field: 'start' | 'end', value: string) => {
    const min = hhmmToMin(value)
    setBhForm(prev => ({
      ...prev,
      schedule: prev.schedule.map(w => (w.wday === wday ? { ...w, [field]: min } : w)),
    }))
  }

  if (loading) return <SkeletonStack count={3} variant="card" />

  return (
    <div className="admin-section" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Clock size={16} style={{ color: 'var(--aae-accent, var(--aae-link))' }} />
        <h3 style={{ margin: 0 }}>Ticketing — SLA &amp; Business Hours</h3>
        <div style={{ flex: 1 }} />
        <button type="button" className="ghost-button" onClick={() => void loadAll()} style={{ fontSize: 13 }}>
          <RefreshCw size={12} style={{ marginRight: 4 }} /> Refresh
        </button>
      </header>

      <p className="mm-editor-hint">
        Configure SLA response and resolution targets per priority, plus the business-hours schedule
        the SLA clock should follow.
      </p>

      {/* Workspace picker */}
      <label className="field-label" style={{ maxWidth: 380 }}>
        Workspace
        <select
          className="slack-input"
          value={workspaceId}
          onChange={e => setWorkspaceId(e.target.value)}
          disabled={!workspaces.length}
        >
          {workspaces.map(w => (
            <option key={w.id} value={w.id}>{w.display_name} ({w.name})</option>
          ))}
        </select>
      </label>

      {error && (
        <div className="mm-auth-alert mm-auth-alert--error" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* ── SLA Policies ───────────────────────────────────────── */}
      <section style={{ borderTop: '1px solid var(--mm-border-subtle)', paddingTop: 16 }}>
        <h4 style={{ margin: '0 0 6px' }}>SLA policies</h4>
        <p className="mm-editor-hint" style={{ marginTop: 0 }}>
          One policy per priority. The SLA clock pauses while a ticket sits in any of the selected statuses.
        </p>
        <div style={{ marginTop: 12 }}>
          <DataTable>
            <thead>
              <tr>
                <th>Priority</th>
                <th>First response</th>
                <th>Resolution</th>
                <th>Pause states</th>
                <th>Business hours</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {PRIORITIES.map(priority => (
                <PolicyRow
                  key={priority}
                  priority={priority}
                  policy={policyByPriority[priority]}
                  hoursList={hoursList}
                  busy={busy}
                  onSave={(first, resolution, pauseOn, bhId) =>
                    createPolicy(priority, first, resolution, pauseOn, bhId)
                  }
                />
              ))}
            </tbody>
          </DataTable>
        </div>
      </section>

      {/* ── Business Hours ──────────────────────────────────────── */}
      <section style={{ borderTop: '1px solid var(--mm-border-subtle)', paddingTop: 16 }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Calendar size={14} style={{ color: 'var(--aae-accent, var(--aae-link))' }} />
          <h4 style={{ margin: 0 }}>Business hours</h4>
        </header>
        <p className="mm-editor-hint" style={{ marginTop: 0 }}>
          Schedules consumed by SLA policies (pause when outside the open window). Defaults to 9–5 Mon–Fri UTC.
        </p>

        <div style={{ marginTop: 12 }}>
          <DataTable>
            <thead>
              <tr>
                <th>Name</th>
                <th>Timezone</th>
                <th>Schedule</th>
                <th>Holidays</th>
              </tr>
            </thead>
            <tbody>
              {hoursList.length === 0 ? (
                <tr><td colSpan={4} className="doc-muted" style={{ padding: 12 }}>No business-hours schedules yet. Use the form below.</td></tr>
              ) : (
                hoursList.map(h => (
                  <tr key={h.id}>
                    <td><strong>{h.name}</strong></td>
                    <td>{h.timezone}</td>
                    <td>
                      {h.schedule.length === 0
                        ? <span className="doc-muted">—</span>
                        : h.schedule.map(w => `${WEEKDAYS.find(d => d.wday === w.wday)?.label || w.wday} ${minToHHMM(w.start)}–${minToHHMM(w.end)}`).join(', ')}
                    </td>
                    <td>{h.holidays.length} day{h.holidays.length === 1 ? '' : 's'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        </div>

        {/* Create form */}
        <Surface bordered padded="md" style={{ marginTop: 16 }}>
          <h5 style={{ margin: '0 0 10px' }}>Add a schedule</h5>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <label className="field-label">
              Name
              <input
                className="slack-input"
                value={bhForm.name}
                onChange={e => setBhForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. Bangkok 9–5"
              />
            </label>
            <label className="field-label">
              IANA timezone
              <input
                className="slack-input"
                value={bhForm.timezone}
                onChange={e => setBhForm(prev => ({ ...prev, timezone: e.target.value }))}
                placeholder="e.g. Asia/Bangkok"
              />
            </label>
          </div>

          <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600 }}>Open windows</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, marginBottom: 12 }}>
            {WEEKDAYS.map(({ wday, label }) => {
              const win = bhForm.schedule.find(w => w.wday === wday)
              const enabled = !!win
              return (
                <Surface key={wday} bordered padded="sm" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, minWidth: 60 }}>
                    <input type="checkbox" checked={enabled} onChange={() => toggleScheduleDay(wday)} />
                    <strong>{label}</strong>
                  </label>
                  <input
                    type="time"
                    disabled={!enabled}
                    value={enabled ? minToHHMM(win!.start) : '09:00'}
                    onChange={e => setScheduleTime(wday, 'start', e.target.value)}
                    style={{ width: 90 }}
                  />
                  <span aria-hidden="true">→</span>
                  <input
                    type="time"
                    disabled={!enabled}
                    value={enabled ? minToHHMM(win!.end) : '17:00'}
                    onChange={e => setScheduleTime(wday, 'end', e.target.value)}
                    style={{ width: 90 }}
                  />
                </Surface>
              )
            })}
          </div>

          <label className="field-label">
            Holidays (YYYY-MM-DD, comma or space separated)
            <textarea
              className="slack-input"
              rows={2}
              value={bhForm.holidays}
              onChange={e => setBhForm(prev => ({ ...prev, holidays: e.target.value }))}
              placeholder="2026-01-01, 2026-04-13, 2026-12-25"
              style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
            />
          </label>

          <button
            type="button"
            className="slack-button"
            disabled={busy || !bhForm.name.trim() || bhForm.schedule.length === 0}
            onClick={() => void createBusinessHours()}
            style={{ marginTop: 10 }}
          >
            <Plus size={13} style={{ marginRight: 4 }} /> Save schedule
          </button>
        </Surface>
      </section>
    </div>
  )
}

/* ───────────────────────────── Sub-rows ──────────────────────────────── */

function PolicyRow({
  priority, policy, hoursList, busy, onSave,
}: {
  priority: TicketPriority
  policy: SlaPolicy | undefined
  hoursList: BusinessHours[]
  busy: boolean
  onSave: (first: number, resolution: number, pauseOn: TicketStatus[], bhId: string | null) => void
}) {
  const defaults: Record<TicketPriority, [number, number]> = {
    critical: [1, 4],
    high: [2, 8],
    medium: [4, 24],
    low: [8, 72],
  }
  const [first, setFirst] = useState(policy ? policy.first_response_ms / HOUR_MS : defaults[priority][0])
  const [resolution, setResolution] = useState(policy ? policy.resolution_ms / HOUR_MS : defaults[priority][1])
  const [pauseOn, setPauseOn] = useState<TicketStatus[]>(policy?.pause_on_status || ['pending'])
  const [bhId, setBhId] = useState<string>(policy?.business_hours_id || '')

  // Sync local state when the upstream policy changes (e.g. after refresh)
  useEffect(() => {
    if (policy) {
      setFirst(policy.first_response_ms / HOUR_MS)
      setResolution(policy.resolution_ms / HOUR_MS)
      setPauseOn(policy.pause_on_status || ['pending'])
      setBhId(policy.business_hours_id || '')
    }
  }, [policy])

  const togglePause = (s: TicketStatus) => {
    setPauseOn(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  return (
    <tr>
      <td style={{ textTransform: 'capitalize', fontWeight: 600 }}>{priority}</td>
      <td>
        <input type="number" min={0.1} step={0.5} className="slack-input"
          style={{ width: 80 }}
          value={first}
          onChange={e => setFirst(Number(e.target.value) || 0)} />
        <span className="doc-muted" style={{ marginLeft: 4, fontSize: 12 }}>h</span>
      </td>
      <td>
        <input type="number" min={0.1} step={0.5} className="slack-input"
          style={{ width: 80 }}
          value={resolution}
          onChange={e => setResolution(Number(e.target.value) || 0)} />
        <span className="doc-muted" style={{ marginLeft: 4, fontSize: 12 }}>h</span>
      </td>
      <td>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PAUSE_STATES.map(s => (
            <label key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              <input type="checkbox" checked={pauseOn.includes(s)} onChange={() => togglePause(s)} />
              <span>{s}</span>
            </label>
          ))}
        </div>
      </td>
      <td>
        <select className="slack-input" value={bhId} onChange={e => setBhId(e.target.value)} style={{ minWidth: 140 }}>
          <option value="">— No business hours —</option>
          {hoursList.map(h => (
            <option key={h.id} value={h.id}>{h.name} ({h.timezone})</option>
          ))}
        </select>
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <button
          type="button"
          className="slack-button"
          disabled={busy || first <= 0 || resolution <= 0 || resolution < first}
          style={{ padding: '5px 12px', fontSize: 12 }}
          onClick={() => onSave(first, resolution, pauseOn, bhId || null)}
          title={resolution < first ? 'Resolution must be ≥ first response' : ''}
        >
          {policy ? `Update (${fmtHours(policy.first_response_ms)} / ${fmtHours(policy.resolution_ms)})` : 'Create'}
        </button>
      </td>
    </tr>
  )
}
