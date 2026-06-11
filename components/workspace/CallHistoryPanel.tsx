'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Phone, Video, Headphones, MonitorUp, Users, Clock, RefreshCw, X, ChevronRight } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'

/**
 * CallHistoryPanel — Slack-style "Past calls" surface (audit §13.8).
 *
 * Lists ended call rooms with type, start/end timestamps, duration,
 * participant count, and the room's title. Active rooms are pinned at
 * the top so users can rejoin in one click.
 */

interface CallRoom {
  id: string
  channel_id: string
  call_type: 'voice' | 'video' | 'huddle' | 'screen_share' | string
  title: string
  status: 'active' | 'ended' | string
  recording: boolean
  max_participants: number
  created_by: string
  created_at: number
  ended_at: number
  created_by_name?: string
  active_participants?: number
}

const TYPE_LABEL: Record<string, string> = {
  voice: 'Voice call',
  video: 'Video call',
  huddle: 'Huddle',
  screen_share: 'Screen share',
}

function callIcon(type: string, size = 14) {
  switch (type) {
    case 'video': return <Video size={size} />
    case 'huddle': return <Headphones size={size} />
    case 'screen_share': return <MonitorUp size={size} />
    case 'voice':
    default: return <Phone size={size} />
  }
}

function durationSec(start: number, end: number): number {
  if (!start) return 0
  if (!end) return Math.max(0, Math.floor((Date.now() - start) / 1000))
  return Math.max(0, Math.floor((end - start) / 1000))
}

function formatDuration(s: number): string {
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}h ${m}m`
}

function formatTime(ts: number): string {
  if (!ts) return '—'
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

interface Props {
  /** Optional channel filter — when set, only show calls from this channel. */
  channelId?: string
  onClose?: () => void
  /** Called when a user clicks a call row to rejoin / view details. */
  onSelectCall?: (room: CallRoom) => void
}

type Filter = 'all' | 'active' | 'ended'

export default function CallHistoryPanel({ channelId, onClose, onSelectCall }: Props) {
  const [rooms, setRooms] = useState<CallRoom[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      // Fetch both active + ended; the API returns up to 50 of each. We do
      // two calls so the "active" list isn't displaced by long ended history.
      const params = new URLSearchParams()
      if (channelId) params.set('channel_id', channelId)
      const [aRes, eRes] = await Promise.all([
        apiFetch(`/api/calls/rooms?${params.toString()}&status=active`),
        apiFetch(`/api/calls/rooms?${params.toString()}&status=ended`),
      ])
      const out: CallRoom[] = []
      if (aRes.ok) {
        const d = (await aRes.json()) as { rooms?: CallRoom[] }
        out.push(...(d.rooms || []))
      }
      if (eRes.ok) {
        const d = (await eRes.json()) as { rooms?: CallRoom[] }
        out.push(...(d.rooms || []))
      }
      setRooms(out)
    } catch {
      setError('Could not load call history.')
    } finally {
      setLoading(false)
    }
  }, [channelId])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    let list = rooms
    if (filter === 'active') list = rooms.filter(r => r.status === 'active')
    else if (filter === 'ended') list = rooms.filter(r => r.status === 'ended')
    return [...list].sort((a, b) => {
      // Active first, then by created_at desc
      if (a.status === 'active' && b.status !== 'active') return -1
      if (b.status === 'active' && a.status !== 'active') return 1
      return b.created_at - a.created_at
    })
  }, [rooms, filter])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--mm-main-bg)', color: 'var(--mm-text)', overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--mm-border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #4361EE, #3A56D4)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Phone size={18} color="#fff" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Call history</h2>
          <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>
            {channelId ? 'Calls in this channel' : 'All voice, video, huddle, and screen-share sessions'}
          </p>
        </div>
        <button type="button" className="ghost-button" onClick={() => void load()}>
          <RefreshCw size={12} /> Refresh
        </button>
        {onClose && (
          <button type="button" className="mm-icon-btn" onClick={onClose} aria-label="Close" style={{ marginLeft: 4 }}>
            <X size={16} />
          </button>
        )}
      </div>

      <div className="thread-filter-bar" style={{ display: 'flex', gap: 6 }}>
        <button type="button"
          className={`mm-notif-filter-tab${filter === 'all' ? ' mm-notif-filter-tab--active' : ''}`}
          onClick={() => setFilter('all')}>
          All ({rooms.length})
        </button>
        <button type="button"
          className={`mm-notif-filter-tab${filter === 'active' ? ' mm-notif-filter-tab--active' : ''}`}
          onClick={() => setFilter('active')}>
          Active ({rooms.filter(r => r.status === 'active').length})
        </button>
        <button type="button"
          className={`mm-notif-filter-tab${filter === 'ended' ? ' mm-notif-filter-tab--active' : ''}`}
          onClick={() => setFilter('ended')}>
          Past ({rooms.filter(r => r.status === 'ended').length})
        </button>
      </div>

      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mm-muted)' }}>
          Loading call history…
        </div>
      ) : error ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mm-muted)', flexDirection: 'column', gap: 12 }}>
          <p>{error}</p>
          <button type="button" className="ghost-button" onClick={() => void load()}>
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mm-muted)' }}>
          <div style={{ textAlign: 'center' }}>
            <Phone size={48} style={{ opacity: 0.4, marginBottom: 16 }} />
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--fg)' }}>No calls yet</h2>
            <p>Voice, video, and huddle sessions appear here once they start.</p>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'auto' }}>
          {filtered.map(r => {
            const dur = durationSec(r.created_at, r.ended_at)
            const active = r.status === 'active'
            return (
              <button
                key={r.id}
                type="button"
                className="call-history-row aae-hoverable"
                onClick={() => onSelectCall?.(r)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                  padding: '12px 20px', textAlign: 'left',
                  background: 'transparent', border: 'none',
                  borderBottom: '1px solid var(--mm-border-subtle)', cursor: 'pointer',
                }}
              >
                <div style={{ width: 38, height: 38, borderRadius: 10, background: active ? 'linear-gradient(135deg, #2bac76, #1f8556)' : 'rgba(0,0,0,0.06)', display: 'grid', placeItems: 'center', color: active ? '#fff' : 'var(--mm-muted)', flexShrink: 0 }}>
                  {callIcon(r.call_type, 16)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {r.title || TYPE_LABEL[r.call_type] || 'Call'}
                    {active && (
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 6, background: '#2bac7620', color: '#2bac76', fontWeight: 700 }}>
                        LIVE
                      </span>
                    )}
                    {r.recording && (
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 6, background: '#e01e5a20', color: '#e01e5a', fontWeight: 700 }}>
                        REC
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span>{TYPE_LABEL[r.call_type] || r.call_type}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <Clock size={11} /> {formatDuration(dur)}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <Users size={11} /> {active ? `${r.active_participants ?? 0} now` : `${r.max_participants} max`}
                    </span>
                    <span>{formatTime(r.created_at)}</span>
                    {r.created_by_name && <span>· started by {r.created_by_name}</span>}
                  </div>
                </div>
                <ChevronRight size={14} style={{ color: 'var(--mm-muted)', flexShrink: 0 }} />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
