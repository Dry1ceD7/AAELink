'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { apiFetch } from '@/lib/apiClient'
import { Calendar, Clock, UserCheck, Plus, Check, X, Trash2, MapPin } from 'lucide-react'

type Tab = 'calendar' | 'leave' | 'attendance'

interface Event {
  id: string
  title: string
  description: string
  start_time: number
  end_time: number
  location: string
  is_all_day: boolean
  created_by: string
  creator_username: string
  first_name?: string
  last_name?: string
}

interface LeaveRequest {
  id: string
  leave_type: string
  start_date: number
  end_date: number
  reason: string
  status: string
  req_first?: string
  req_last?: string
  req_username: string
  app_first?: string
  app_last?: string
  app_username?: string
  created_at: number
}

interface AttendanceLog {
  id: string
  date_str: string
  clock_in_time: number
  clock_out_time: number | null
  note: string
  first_name?: string
  last_name?: string
  username: string
}

/**
 * Some upstream HR systems store dates as ISO date strings (e.g. "2024-06-12"),
 * others as numeric millisecond timestamps. Both shapes can hit the client
 * through JSON. Normalize to a Date safely.
 */
function safeDate(value: number | string | null | undefined): Date | null {
  if (value == null) return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null
    return new Date(value)
  }
  // Numeric strings (e.g. "1717113600000")
  if (/^\d{10,}$/.test(value)) return new Date(Number(value))
  const d = new Date(value)
  return isNaN(d.getTime()) ? null : d
}

function formatDate(value: number | string | null | undefined): string {
  const d = safeDate(value)
  return d ? d.toLocaleDateString() : '—'
}

function formatDateTime(value: number | string | null | undefined): string {
  const d = safeDate(value)
  return d ? d.toLocaleString() : '—'
}

function formatTime(value: number | string | null | undefined): string {
  const d = safeDate(value)
  return d ? d.toLocaleTimeString() : '—'
}

function formatDuration(start: number | null, end: number | null): string {
  if (!start || !end || end < start) return ''
  const ms = end - start
  const totalMin = Math.floor(ms / 60000)
  const hours = Math.floor(totalMin / 60)
  const minutes = totalMin % 60
  if (hours <= 0) return `${minutes} min`
  return `${hours} hr ${minutes} min`
}

function isSameLocalDate(ts: number | null | undefined, ref: Date): boolean {
  if (!ts) return false
  const d = new Date(ts)
  return d.getFullYear() === ref.getFullYear() &&
         d.getMonth() === ref.getMonth() &&
         d.getDate() === ref.getDate()
}

export function CalendarPanel({ workspaceId }: { workspaceId: string }) {
  const [activeTab, setActiveTab] = useState<Tab>('calendar')

  const [events, setEvents] = useState<Event[]>([])
  const [leaves, setLeaves] = useState<LeaveRequest[]>([])
  const [attendance, setAttendance] = useState<AttendanceLog[]>([])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [showEventForm, setShowEventForm] = useState(false)
  const [showLeaveForm, setShowLeaveForm] = useState(false)
  const [todayOnly, setTodayOnly] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      if (activeTab === 'calendar') {
        const res = await apiFetch(`/api/calendar/events?workspace_id=${workspaceId}`)
        if (!res.ok) throw new Error('Failed to load events')
        const data = await res.json()
        setEvents(data.events || [])
      } else if (activeTab === 'leave') {
        const res = await apiFetch(`/api/hr/leave?workspace_id=${workspaceId}`)
        if (!res.ok) throw new Error('Failed to load leave requests')
        const data = await res.json()
        setLeaves(data.leaves || [])
      } else if (activeTab === 'attendance') {
        const res = await apiFetch(`/api/hr/attendance?workspace_id=${workspaceId}`)
        if (!res.ok) throw new Error('Failed to load attendance')
        const data = await res.json()
        setAttendance(data.logs || [])
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'data_load_failed')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, activeTab])

  useEffect(() => { void loadData() }, [loadData])

  const handleCreateEvent = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const title = (form.elements.namedItem('title') as HTMLInputElement).value
    const description = (form.elements.namedItem('description') as HTMLTextAreaElement).value
    const location = (form.elements.namedItem('location') as HTMLInputElement).value
    const start_time = new Date((form.elements.namedItem('start_time') as HTMLInputElement).value).getTime()
    const end_time = new Date((form.elements.namedItem('end_time') as HTMLInputElement).value).getTime()

    try {
      const res = await apiFetch('/api/calendar/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, title, description, location, start_time, end_time })
      })
      if (!res.ok) throw new Error('Failed to create event')
      setShowEventForm(false)
      loadData()
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'event_create_failed') }
  }

  const handleDeleteEvent = async (id: string) => {
    if (!confirm('Delete this event? This cannot be undone.')) return
    try {
      const res = await apiFetch(`/api/calendar/events/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error || 'Failed to delete event')
      }
      loadData()
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'event_delete_failed') }
  }

  const handleCreateLeave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const type = (form.elements.namedItem('type') as HTMLSelectElement).value
    const reason = (form.elements.namedItem('reason') as HTMLInputElement).value
    const start_date = new Date((form.elements.namedItem('start_date') as HTMLInputElement).value).getTime()
    const end_date = new Date((form.elements.namedItem('end_date') as HTMLInputElement).value).getTime()

    try {
      const res = await apiFetch('/api/hr/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, leave_type: type, reason, start_date, end_date })
      })
      if (!res.ok) throw new Error('Failed to submit leave request')
      setShowLeaveForm(false)
      loadData()
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'leave_submit_failed') }
  }

  const handleLeaveAction = async (id: string, status: 'approved' | 'rejected') => {
    try {
      const res = await apiFetch(`/api/hr/leave/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      })
      if (!res.ok) throw new Error('Failed to update leave request')
      loadData()
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'leave_action_failed') }
  }

  const handleAttendance = async (action: 'in' | 'out') => {
    try {
      const res = await apiFetch('/api/hr/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, action })
      })
      if (!res.ok) throw new Error('Failed to update attendance')
      loadData()
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'attendance_failed') }
  }

  const filteredAttendance = useMemo(() => {
    if (!todayOnly) return attendance
    const now = new Date()
    return attendance.filter(a => isSameLocalDate(a.clock_in_time, now))
  }, [attendance, todayOnly])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--mm-border-color)', padding: '16px 24px 0', gap: 24 }}>
        <button
          className={`tab-button ${activeTab === 'calendar' ? 'active' : ''}`}
          onClick={() => setActiveTab('calendar')}
          style={{ padding: '8px 0', borderBottom: activeTab === 'calendar' ? '2px solid var(--mm-link-color)' : '2px solid transparent', color: activeTab === 'calendar' ? 'var(--mm-link-color)' : 'var(--mm-muted)', background: 'none', borderTop: 'none', borderLeft: 'none', borderRight: 'none', cursor: 'pointer', fontWeight: 600 }}
        >
          <Calendar size={16} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} /> Events
        </button>
        <button
          className={`tab-button ${activeTab === 'leave' ? 'active' : ''}`}
          onClick={() => setActiveTab('leave')}
          style={{ padding: '8px 0', borderBottom: activeTab === 'leave' ? '2px solid var(--mm-link-color)' : '2px solid transparent', color: activeTab === 'leave' ? 'var(--mm-link-color)' : 'var(--mm-muted)', background: 'none', borderTop: 'none', borderLeft: 'none', borderRight: 'none', cursor: 'pointer', fontWeight: 600 }}
        >
          <UserCheck size={16} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} /> Leave Requests
        </button>
        <button
          className={`tab-button ${activeTab === 'attendance' ? 'active' : ''}`}
          onClick={() => setActiveTab('attendance')}
          style={{ padding: '8px 0', borderBottom: activeTab === 'attendance' ? '2px solid var(--mm-link-color)' : '2px solid transparent', color: activeTab === 'attendance' ? 'var(--mm-link-color)' : 'var(--mm-muted)', background: 'none', borderTop: 'none', borderLeft: 'none', borderRight: 'none', cursor: 'pointer', fontWeight: 600 }}
        >
          <Clock size={16} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} /> Attendance
        </button>
      </div>

      <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
        {error && <p className="form-error">{error}</p>}
        {loading && <p>Loading...</p>}

        {/* CALENDAR VIEW */}
        {activeTab === 'calendar' && !loading && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3>Upcoming Events</h3>
              <button className="slack-button" onClick={() => setShowEventForm(!showEventForm)}>
                <Plus size={16} style={{ marginRight: 6 }} /> New Event
              </button>
            </div>

            {showEventForm && (
              <form onSubmit={handleCreateEvent} className="admin-table" style={{ padding: 16, marginBottom: 24, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <input name="title" className="slack-input" required placeholder="Event Title" />
                <textarea name="description" className="slack-input" placeholder="Description (optional)" style={{ minHeight: 80, fontFamily: 'inherit' }} />
                <input name="location" className="slack-input" placeholder="Location (e.g. 'Meeting Room 3' or Zoom URL)" />
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label className="admin-label">Starts</label>
                    <input name="start_time" type="datetime-local" className="slack-input" required />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="admin-label">Ends</label>
                    <input name="end_time" type="datetime-local" className="slack-input" required />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="slack-button">Create</button>
                  <button type="button" className="ghost-button" onClick={() => setShowEventForm(false)}>Cancel</button>
                </div>
              </form>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {events.length === 0 ? <p className="muted">No upcoming events.</p> : events.map(e => (
                <div key={e.id} className="admin-table" style={{ padding: 12, borderRadius: 8, borderLeft: '4px solid var(--mm-link-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h4 style={{ margin: '0 0 4px 0' }}>{e.title}</h4>
                    <div style={{ fontSize: 13, color: 'var(--mm-muted)' }}>
                      {formatDateTime(e.start_time)} – {formatDateTime(e.end_time)}
                      <span style={{ margin: '0 8px' }}>&bull;</span>
                      Organized by {e.first_name ? `${e.first_name} ${e.last_name}` : e.creator_username}
                    </div>
                    {e.location && (
                      <div style={{ fontSize: 13, color: 'var(--mm-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <MapPin size={13} /> {e.location}
                      </div>
                    )}
                    {e.description && (
                      <p style={{ margin: '6px 0 0 0', fontSize: 13, whiteSpace: 'pre-wrap' }}>
                        {e.description}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => handleDeleteEvent(e.id)}
                    title="Delete event"
                    style={{ color: '#c5221f', padding: 6 }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* LEAVE REQUESTS VIEW */}
        {activeTab === 'leave' && !loading && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3>Time Off Requests</h3>
              <button className="slack-button" onClick={() => setShowLeaveForm(!showLeaveForm)}>
                <Plus size={16} style={{ marginRight: 6 }} /> Request Leave
              </button>
            </div>

            {showLeaveForm && (
              <form onSubmit={handleCreateLeave} className="admin-table" style={{ padding: 16, marginBottom: 24, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <select name="type" className="slack-input" required defaultValue="vacation">
                  <option value="vacation">Vacation</option>
                  <option value="sick">Sick Leave</option>
                  <option value="personal">Personal Reason</option>
                  <option value="other">Other</option>
                </select>
                <input name="reason" className="slack-input" placeholder="Reason (optional)" />
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}><label className="admin-label">Start Date</label><input name="start_date" type="date" className="slack-input" required /></div>
                  <div style={{ flex: 1 }}><label className="admin-label">End Date</label><input name="end_date" type="date" className="slack-input" required /></div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="slack-button">Submit Request</button>
                  <button type="button" className="ghost-button" onClick={() => setShowLeaveForm(false)}>Cancel</button>
                </div>
              </form>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {leaves.length === 0 ? <p className="muted">No leave requests.</p> : leaves.map(l => (
                <div key={l.id} className="admin-table" style={{ padding: 12, borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h4 style={{ margin: '0 0 4px 0', textTransform: 'capitalize' }}>
                      {l.leave_type} Leave
                      <span style={{
                        marginLeft: 8, fontSize: 11, padding: '2px 6px', borderRadius: 8,
                        background: l.status === 'approved' ? '#e6f4ea' : l.status === 'rejected' ? '#fce8e6' : 'var(--mm-sidebar-hover)',
                        color: l.status === 'approved' ? '#137333' : l.status === 'rejected' ? '#c5221f' : 'var(--mm-text)'
                      }}>
                        {l.status}
                      </span>
                    </h4>
                    <div style={{ fontSize: 13, color: 'var(--mm-muted)' }}>
                      {formatDate(l.start_date)} to {formatDate(l.end_date)}
                      <span style={{ margin: '0 8px' }}>&bull;</span>
                      Requested by {l.req_first ? `${l.req_first} ${l.req_last}` : l.req_username}
                    </div>
                    {l.reason && (
                      <div style={{ fontSize: 13, color: 'var(--mm-text)', opacity: 0.8, marginTop: 4 }}>
                        “{l.reason}”
                      </div>
                    )}
                  </div>

                  {l.status === 'pending' && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="ghost-button" style={{ color: '#137333' }} onClick={() => handleLeaveAction(l.id, 'approved')} title="Approve">
                        <Check size={16} />
                      </button>
                      <button className="ghost-button" style={{ color: '#c5221f' }} onClick={() => handleLeaveAction(l.id, 'rejected')} title="Reject">
                        <X size={16} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ATTENDANCE VIEW */}
        {activeTab === 'attendance' && !loading && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>Timesheets</h3>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  type="button"
                  className={todayOnly ? 'slack-button' : 'ghost-button'}
                  onClick={() => setTodayOnly(v => !v)}
                  title="Filter to today's records"
                >
                  Today
                </button>
                <button className="slack-button" style={{ background: '#137333', color: 'white', borderColor: '#137333' }} onClick={() => handleAttendance('in')}>
                  Clock In
                </button>
                <button className="ghost-button" style={{ border: '1px solid #c5221f', color: '#c5221f' }} onClick={() => handleAttendance('out')}>
                  Clock Out
                </button>
              </div>
            </div>

            <div className="admin-table" style={{ borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
                <thead style={{ background: 'var(--mm-sidebar-bg)' }}>
                  <tr>
                    <th style={{ padding: 12, borderBottom: '1px solid var(--mm-border-color)' }}>Date</th>
                    <th style={{ padding: 12, borderBottom: '1px solid var(--mm-border-color)' }}>User</th>
                    <th style={{ padding: 12, borderBottom: '1px solid var(--mm-border-color)' }}>Clock In</th>
                    <th style={{ padding: 12, borderBottom: '1px solid var(--mm-border-color)' }}>Clock Out</th>
                    <th style={{ padding: 12, borderBottom: '1px solid var(--mm-border-color)' }}>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAttendance.length === 0 ? (
                    <tr><td colSpan={5} style={{ padding: 12, textAlign: 'center', color: 'var(--mm-muted)' }}>No records</td></tr>
                  ) : filteredAttendance.map(a => (
                    <tr key={a.id} style={{ borderBottom: '1px solid var(--mm-border-color)' }}>
                      <td style={{ padding: 12 }}>{a.date_str}</td>
                      <td style={{ padding: 12 }}>{a.first_name ? `${a.first_name} ${a.last_name}` : a.username}</td>
                      <td style={{ padding: 12, color: '#137333' }}>{formatTime(a.clock_in_time)}</td>
                      <td style={{ padding: 12, color: a.clock_out_time ? '#c5221f' : 'var(--mm-muted)' }}>
                        {a.clock_out_time ? formatTime(a.clock_out_time) : 'Active'}
                      </td>
                      <td style={{ padding: 12, color: 'var(--mm-muted)' }}>
                        {a.clock_out_time ? formatDuration(a.clock_in_time, a.clock_out_time) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
