'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api/apiClient'
import { BarChart3, X, TrendingUp, TrendingDown, Minus, Users, MessageSquare, Paperclip, Lock, Loader2, Hash } from 'lucide-react'

/* ── Channel Analytics — Wired to /api/analytics/channels ─────────── */

interface ChannelStat {
  id: string
  name: string
  type: 'public' | 'private'
  members: number
  messagesDay: number
  messagesWeek: number
  messagesMonth: number
  filesShared: number
  activePosters: number
  topPoster: string
  trend: 'up' | 'down' | 'flat'
  lastActivity: string
}

const trendConfig: Record<string, { Icon: typeof TrendingUp; color: string }> = {
  up: { Icon: TrendingUp, color: '#2bac76' },
  down: { Icon: TrendingDown, color: '#e01e5a' },
  flat: { Icon: Minus, color: '#8b8b8b' },
}

export default function ChannelAnalyticsPanel({ onClose }: { onClose: () => void }) {
  const [stats, setStats] = useState<ChannelStat[]>([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState<'messages' | 'members' | 'files'>('messages')
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('week')

  const loadStats = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/analytics/channels')
      if (res.ok) {
        const data = await res.json()
        setStats(data.channels || [])
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { loadStats() }, [loadStats])

  const sorted = [...stats].sort((a, b) => {
    if (sortBy === 'members') return b.members - a.members
    if (sortBy === 'files') return b.filesShared - a.filesShared
    const key = period === 'day' ? 'messagesDay' : period === 'week' ? 'messagesWeek' : 'messagesMonth'
    return (b[key] || 0) - (a[key] || 0)
  })

  const totalMessages = stats.reduce((s, c) => s + (c.messagesWeek || 0), 0)
  const totalFiles = stats.reduce((s, c) => s + (c.filesShared || 0), 0)
  const largestChannel = stats.reduce((max, c) => Math.max(max, c.members || 0), 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--mm-main-bg)', color: 'var(--mm-text)' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--mm-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #06b6d4, #0891b2)', display: 'grid', placeItems: 'center' }}>
              <BarChart3 size={18} color="#fff" />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Channel Analytics</h2>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>Usage statistics across all channels</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
          {[
            { label: 'Total Channels', value: stats.length, color: '#4361EE', Icon: Hash },
            { label: 'Messages (Week)', value: totalMessages.toLocaleString(), color: '#2bac76', Icon: MessageSquare },
            { label: 'Largest Channel', value: largestChannel, color: '#e8912d', Icon: Users },
            { label: 'Files Shared', value: totalFiles, color: '#8b5cf6', Icon: Paperclip },
          ].map(s => (
            <div key={s.label} style={{ padding: 12, borderRadius: 10, border: '1px solid var(--mm-border)', textAlign: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <s.Icon size={16} style={{ color: s.color }} />
                <span style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</span>
              </div>
              <div style={{ fontSize: 11, opacity: 0.6 }}>{s.label}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['day', 'week', 'month'] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)} style={{
                padding: '4px 10px', borderRadius: 6, border: 'none', fontSize: 12, cursor: 'pointer', textTransform: 'capitalize',
                fontWeight: period === p ? 700 : 500,
                background: period === p ? '#06b6d4' : 'var(--mm-hover-bg)',
                color: period === p ? '#fff' : 'var(--mm-text)',
              }}>{p}</button>
            ))}
          </div>
          <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)} style={{
            padding: '4px 10px', borderRadius: 6, border: '1px solid var(--mm-border)',
            background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 12,
          }}>
            <option value="messages">Sort: Messages</option>
            <option value="members">Sort: Members</option>
            <option value="files">Sort: Files</option>
          </select>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60, opacity: 0.5 }}>
            <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 13, marginTop: 8 }}>Loading analytics…</span>
          </div>
        ) : sorted.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60, opacity: 0.5 }}>
            <BarChart3 size={36} />
            <span style={{ fontSize: 14, fontWeight: 600, marginTop: 8 }}>No channel data yet</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sorted.map((ch, idx) => {
              const tr = trendConfig[ch.trend] || trendConfig.flat
              const msgCount = period === 'day' ? ch.messagesDay : period === 'week' ? ch.messagesWeek : ch.messagesMonth
              const maxMsg = Math.max(...sorted.map(s => period === 'day' ? s.messagesDay : period === 'week' ? s.messagesWeek : s.messagesMonth))
              const barWidth = maxMsg > 0 ? ((msgCount || 0) / maxMsg) * 100 : 0
              return (
                <div key={ch.id} style={{ padding: 14, borderRadius: 12, border: '1px solid var(--mm-border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#06b6d4', width: 20, textAlign: 'center' }}>#{idx + 1}</span>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{ch.name}</span>
                      {ch.type === 'private' && <Lock size={12} style={{ opacity: 0.4 }} />}
                      <tr.Icon size={14} style={{ color: tr.color }} />
                    </div>
                    <div style={{ display: 'flex', gap: 16, fontSize: 12, opacity: 0.7 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Users size={11} /> {ch.members}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><MessageSquare size={11} /> {msgCount || 0}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Paperclip size={11} /> {ch.filesShared}</span>
                    </div>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: 'var(--mm-hover-bg)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 3, background: 'linear-gradient(90deg, #06b6d4, #4361EE)', width: `${barWidth}%`, transition: 'width 300ms ease' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, opacity: 0.5 }}>
                    <span>{ch.activePosters} active posters · Top: {ch.topPoster}</span>
                    <span>Last: {ch.lastActivity}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
