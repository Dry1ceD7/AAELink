'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  X, CalendarDays, Clock, UserCheck, Plus, Loader2,
  CheckCircle2, XCircle, Timer, AlertCircle,
} from 'lucide-react'

/* ─────────────────────────────────────────────────────────────────────
   HRPanel — Attendance tracking & Leave request management
   • Clock in / Clock out with live timer
   • Leave request CRUD (submit, approve/reject, delete)
   • API-backed: /api/hr/attendance, /api/hr/leave, /api/hr/leave/:id
   ───────────────────────────────────────────────────────────────────── */

interface AttendanceLog {
  id: string
  user_id: string
  username: string
  first_name: string
  last_name: string
  clock_in_time: number
  clock_out_time: number | null
  date_str: string
  note: string
  created_at: number
}

interface LeaveRequest {
  id: string
  user_id: string
  req_username: string
  req_first: string
  req_last: string
  leave_type: string
  start_date: number
  end_date: number
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  approved_by: string | null
  app_username: string | null
  app_first: string | null
  app_last: string | null
  created_at: number
  updated_at: number
}

const LEAVE_TYPES = [
  { value: 'annual', label: 'Annual Leave', color: '#4361EE' },
  { value: 'sick', label: 'Sick Leave', color: '#e74c3c' },
  { value: 'personal', label: 'Personal Leave', color: '#f39c12' },
  { value: 'maternity', label: 'Maternity/Paternity', color: '#2ecc71' },
  { value: 'bereavement', label: 'Bereavement', color: '#95a5a6' },
  { value: 'other', label: 'Other', color: '#8e44ad' },
]

function formatDate(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

function formatDuration(ms: number): string {
  const hrs = Math.floor(ms / 3600000)
  const mins = Math.floor((ms % 3600000) / 60000)
  return `${hrs}h ${mins}m`
}

const STATUS_BADGE: Record<string, { bg: string; color: string; Icon: typeof CheckCircle2 }> = {
  pending: { bg: 'rgba(243,156,18,0.12)', color: '#f39c12', Icon: Timer },
  approved: { bg: 'rgba(46,204,113,0.12)', color: '#2ecc71', Icon: CheckCircle2 },
  rejected: { bg: 'rgba(231,76,60,0.12)', color: '#e74c3c', Icon: XCircle },
}

export default function HRPanel({ onClose, workspaceId }: {
  onClose: () => void
  workspaceId: string
}) {
  const [tab, setTab] = useState<'attendance' | 'leave'>('attendance')
  const [attendance, setAttendance] = useState<AttendanceLog[]>([])
  const [leaves, setLeaves] = useState<LeaveRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [clockedIn, setClockedIn] = useState(false)
  const [clockInTime, setClockInTime] = useState(0)
  const [elapsed, setElapsed] = useState('')
  const [showLeaveForm, setShowLeaveForm] = useState(false)
  const [leaveType, setLeaveType] = useState('annual')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // ── Fetch attendance ────────────────────────────────────────────────
  const fetchAttendance = useCallback(async () => {
    try {
      const res = await fetch(`/api/hr/attendance?workspace_id=${workspaceId}`)
      const data = await res.json()
      if (data.logs) {
        setAttendance(data.logs)
        // Check if user has an active clock-in today
        const today = new Date()
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
        const active = data.logs.find(
          (l: AttendanceLog) => l.date_str === todayStr && !l.clock_out_time
        )
        if (active) {
          setClockedIn(true)
          setClockInTime(Number(active.clock_in_time))
        }
      }
    } catch { /* handled by empty state */ }
  }, [workspaceId])

  // ── Fetch leave requests ────────────────────────────────────────────
  const fetchLeaves = useCallback(async () => {
    try {
      const res = await fetch(`/api/hr/leave?workspace_id=${workspaceId}`)
      const data = await res.json()
      if (data.leaves) setLeaves(data.leaves)
    } catch { /* handled by empty state */ }
  }, [workspaceId])

  useEffect(() => {
    setLoading(true)
    Promise.all([fetchAttendance(), fetchLeaves()]).finally(() => setLoading(false))
  }, [fetchAttendance, fetchLeaves])

  // ── Live elapsed timer ──────────────────────────────────────────────
  useEffect(() => {
    if (!clockedIn || !clockInTime) return
    const tick = () => setElapsed(formatDuration(Date.now() - clockInTime))
    tick()
    const id = setInterval(tick, 30_000) // update every 30s
    return () => clearInterval(id)
  }, [clockedIn, clockInTime])

  // ── Clock in/out handlers ───────────────────────────────────────────
  const handleClockAction = async (action: 'in' | 'out') => {
    setSubmitting(true)
    try {
      await fetch('/api/hr/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, action }),
      })
      if (action === 'in') {
        setClockedIn(true)
        setClockInTime(Date.now())
      } else {
        setClockedIn(false)
        setClockInTime(0)
        setElapsed('')
      }
      await fetchAttendance()
    } catch { /* ignore */ } finally {
      setSubmitting(false)
    }
  }

  // ── Submit leave request ────────────────────────────────────────────
  const submitLeave = async () => {
    if (!startDate || !endDate) return
    setSubmitting(true)
    try {
      await fetch('/api/hr/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          leave_type: leaveType,
          start_date: new Date(startDate).getTime(),
          end_date: new Date(endDate).getTime(),
          reason,
        }),
      })
      setShowLeaveForm(false)
      setStartDate('')
      setEndDate('')
      setReason('')
      await fetchLeaves()
    } catch { /* ignore */ } finally {
      setSubmitting(false)
    }
  }

  // ── Review leave request ────────────────────────────────────────────
  const reviewLeave = async (id: string, status: 'approved' | 'rejected') => {
    try {
      await fetch(`/api/hr/leave/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      await fetchLeaves()
    } catch { /* ignore */ }
  }

  // ── Delete leave request ────────────────────────────────────────────
  const deleteLeave = async (id: string) => {
    try {
      await fetch(`/api/hr/leave/${id}`, { method: 'DELETE' })
      await fetchLeaves()
    } catch { /* ignore */ }
  }

  const TABS = [
    { key: 'attendance' as const, label: 'Attendance', Icon: Clock },
    { key: 'leave' as const, label: 'Leave Requests', Icon: CalendarDays },
  ]

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--mm-main-bg)', color: 'var(--mm-text)',
      borderLeft: '1px solid var(--mm-border)',
      animation: 'slack-panel-slide-in 250ms var(--slack-ease-out) forwards',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid var(--mm-border)',
        background: 'linear-gradient(135deg, rgba(46,204,113,0.06), rgba(67,97,238,0.04))',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 28, height: 28, borderRadius: 8,
              background: 'linear-gradient(135deg, #2ecc71, #27ae60)',
              display: 'grid', placeItems: 'center',
            }}><UserCheck size={14} color="#fff" /></span>
            <span style={{ fontWeight: 700, fontSize: 15 }}>HR & Attendance</span>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none',
            cursor: 'pointer', color: 'var(--mm-muted)',
          }}><X size={18} /></button>
        </div>

        <div style={{ display: 'flex', gap: 4 }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              padding: '6px 12px', borderRadius: 8, border: 'none',
              cursor: 'pointer', fontSize: 12, fontWeight: tab === t.key ? 700 : 400,
              background: tab === t.key ? 'var(--mm-hover-bg)' : 'none',
              color: tab === t.key ? 'var(--mm-link)' : 'var(--mm-muted)',
              display: 'flex', alignItems: 'center', gap: 4,
            }}><t.Icon size={13} /> {t.label}</button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Loader2 size={24} className="slack-spin" style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        ) : tab === 'attendance' ? (
          <>
            {/* Clock in/out card */}
            <div style={{
              padding: 20, borderRadius: 12,
              border: '1px solid var(--mm-border)',
              background: clockedIn
                ? 'linear-gradient(135deg, rgba(46,204,113,0.08), rgba(39,174,96,0.04))'
                : 'var(--mm-rhs-bg)',
              marginBottom: 20, textAlign: 'center',
            }}>
              <div style={{ fontSize: 13, opacity: 0.6, marginBottom: 8 }}>
                {clockedIn ? 'Currently Clocked In' : 'Not Clocked In'}
              </div>
              {clockedIn && elapsed && (
                <div style={{ fontSize: 28, fontWeight: 800, color: '#2ecc71', marginBottom: 12 }}>
                  {elapsed}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                {!clockedIn ? (
                  <button onClick={() => handleClockAction('in')} disabled={submitting} style={{
                    background: '#2ecc71', border: 'none', borderRadius: 8,
                    padding: '10px 28px', color: '#fff', fontSize: 13, fontWeight: 600,
                    cursor: 'pointer', opacity: submitting ? 0.6 : 1,
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}><Clock size={14} /> Clock In</button>
                ) : (
                  <button onClick={() => handleClockAction('out')} disabled={submitting} style={{
                    background: '#e74c3c', border: 'none', borderRadius: 8,
                    padding: '10px 28px', color: '#fff', fontSize: 13, fontWeight: 600,
                    cursor: 'pointer', opacity: submitting ? 0.6 : 1,
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}><Clock size={14} /> Clock Out</button>
                )}
              </div>
            </div>

            {/* Attendance logs */}
            <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
              Recent Attendance ({attendance.length})
            </div>
            {attendance.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 30, opacity: 0.4 }}>
                <Clock size={32} style={{ marginBottom: 8, opacity: 0.4 }} />
                <div style={{ fontSize: 13 }}>No attendance records yet</div>
              </div>
            ) : (
              attendance.slice(0, 20).map(log => (
                <div key={log.id} style={{
                  padding: '10px 14px', borderRadius: 10,
                  border: '1px solid var(--mm-border)',
                  background: 'var(--mm-rhs-bg)', marginBottom: 8,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>
                        {log.first_name || log.username}
                      </span>
                      <span style={{ fontSize: 11, opacity: 0.4, marginLeft: 8 }}>
                        {log.date_str}
                      </span>
                    </div>
                    <span style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 6,
                      background: log.clock_out_time ? 'rgba(46,204,113,0.12)' : 'rgba(243,156,18,0.12)',
                      color: log.clock_out_time ? '#2ecc71' : '#f39c12',
                      fontWeight: 600,
                    }}>
                      {log.clock_out_time ? 'Completed' : 'Active'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>
                    In: {formatTime(Number(log.clock_in_time))}
                    {log.clock_out_time && ` · Out: ${formatTime(Number(log.clock_out_time))}`}
                    {log.clock_out_time && ` · ${formatDuration(Number(log.clock_out_time) - Number(log.clock_in_time))}`}
                  </div>
                  {log.note && (
                    <div style={{ fontSize: 12, opacity: 0.5, marginTop: 2, fontStyle: 'italic' }}>
                      {log.note}
                    </div>
                  )}
                </div>
              ))
            )}
          </>
        ) : (
          <>
            {/* Leave request form toggle */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Leave Requests ({leaves.length})
              </div>
              <button onClick={() => setShowLeaveForm(!showLeaveForm)} style={{
                background: showLeaveForm ? 'var(--mm-hover-bg)' : '#4361EE',
                border: 'none', borderRadius: 8,
                padding: '6px 14px', color: showLeaveForm ? 'var(--mm-text)' : '#fff',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                {showLeaveForm ? <X size={12} /> : <Plus size={12} />}
                {showLeaveForm ? 'Cancel' : 'New Request'}
              </button>
            </div>

            {/* Leave request form */}
            {showLeaveForm && (
              <div style={{
                padding: 16, borderRadius: 12,
                border: '1px solid var(--mm-border)',
                background: 'var(--mm-rhs-bg)', marginBottom: 16,
              }}>
                <div style={{ display: 'grid', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, opacity: 0.6, display: 'block', marginBottom: 4 }}>Leave Type</label>
                    <select value={leaveType} onChange={e => setLeaveType(e.target.value)} style={{
                      width: '100%', padding: '8px 10px', borderRadius: 8,
                      border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)',
                      color: 'var(--mm-text)', fontSize: 13, outline: 'none',
                    }}>
                      {LEAVE_TYPES.map(lt => (
                        <option key={lt.value} value={lt.value}>{lt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, opacity: 0.6, display: 'block', marginBottom: 4 }}>Start Date</label>
                      <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{
                        width: '100%', padding: '8px 10px', borderRadius: 8,
                        border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)',
                        color: 'var(--mm-text)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
                      }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, opacity: 0.6, display: 'block', marginBottom: 4 }}>End Date</label>
                      <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{
                        width: '100%', padding: '8px 10px', borderRadius: 8,
                        border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)',
                        color: 'var(--mm-text)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
                      }} />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, opacity: 0.6, display: 'block', marginBottom: 4 }}>Reason</label>
                    <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} style={{
                      width: '100%', padding: '8px 10px', borderRadius: 8,
                      border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)',
                      color: 'var(--mm-text)', fontSize: 13, outline: 'none', resize: 'vertical',
                      fontFamily: 'inherit', boxSizing: 'border-box',
                    }} placeholder="Optional reason for leave…" />
                  </div>
                  <button onClick={submitLeave} disabled={submitting || !startDate || !endDate} style={{
                    background: '#4361EE', border: 'none', borderRadius: 8,
                    padding: '10px 20px', color: '#fff', fontSize: 13, fontWeight: 600,
                    cursor: 'pointer', opacity: submitting || !startDate || !endDate ? 0.5 : 1,
                  }}>Submit Request</button>
                </div>
              </div>
            )}

            {/* Leave request list */}
            {leaves.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 30, opacity: 0.4 }}>
                <CalendarDays size={32} style={{ marginBottom: 8, opacity: 0.4 }} />
                <div style={{ fontSize: 13 }}>No leave requests found</div>
              </div>
            ) : (
              leaves.map(lv => {
                const badge = STATUS_BADGE[lv.status] || STATUS_BADGE.pending
                const leaveInfo = LEAVE_TYPES.find(lt => lt.value === lv.leave_type) || LEAVE_TYPES[5]
                return (
                  <div key={lv.id} style={{
                    padding: '12px 14px', borderRadius: 10,
                    border: '1px solid var(--mm-border)',
                    background: 'var(--mm-rhs-bg)', marginBottom: 8,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                          fontSize: 10, padding: '2px 8px', borderRadius: 6,
                          background: `${leaveInfo.color}18`, color: leaveInfo.color,
                          fontWeight: 600,
                        }}>{leaveInfo.label}</span>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>
                          {lv.req_first || lv.req_username}
                        </span>
                      </div>
                      <span style={{
                        fontSize: 10, padding: '2px 8px', borderRadius: 6,
                        background: badge.bg, color: badge.color,
                        fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3,
                      }}>
                        <badge.Icon size={10} /> {lv.status}
                      </span>
                    </div>

                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      {formatDate(Number(lv.start_date))} → {formatDate(Number(lv.end_date))}
                    </div>
                    {lv.reason && (
                      <div style={{ fontSize: 12, opacity: 0.5, marginTop: 4, fontStyle: 'italic' }}>
                        {lv.reason}
                      </div>
                    )}
                    {lv.approved_by && (
                      <div style={{ fontSize: 11, opacity: 0.4, marginTop: 4 }}>
                        {lv.status === 'approved' ? 'Approved' : 'Rejected'} by {lv.app_first || lv.app_username}
                      </div>
                    )}

                    {lv.status === 'pending' && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        <button onClick={() => reviewLeave(lv.id, 'approved')} style={{
                          background: 'rgba(46,204,113,0.12)', border: '1px solid rgba(46,204,113,0.3)',
                          borderRadius: 6, padding: '4px 12px', fontSize: 11, fontWeight: 600,
                          color: '#2ecc71', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                        }}><CheckCircle2 size={11} /> Approve</button>
                        <button onClick={() => reviewLeave(lv.id, 'rejected')} style={{
                          background: 'rgba(231,76,60,0.12)', border: '1px solid rgba(231,76,60,0.3)',
                          borderRadius: 6, padding: '4px 12px', fontSize: 11, fontWeight: 600,
                          color: '#e74c3c', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                        }}><XCircle size={11} /> Reject</button>
                        <button onClick={() => deleteLeave(lv.id)} style={{
                          background: 'none', border: '1px solid var(--mm-border)',
                          borderRadius: 6, padding: '4px 12px', fontSize: 11,
                          color: 'var(--mm-muted)', cursor: 'pointer', marginLeft: 'auto',
                        }}>Delete</button>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: '8px 16px', borderTop: '1px solid var(--mm-border)',
        fontSize: 11, opacity: 0.4, display: 'flex', alignItems: 'center', gap: 4,
      }}>
        <AlertCircle size={11} /> Data synced with HR backend
      </div>
    </div>
  )
}
