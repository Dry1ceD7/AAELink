'use client'

import { useCallback, useEffect, useState } from 'react'
import { Monitor, Smartphone, Globe, Trash2, Shield, Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'

interface SessionRow {
  id: string
  user_agent: string
  ip_address: string
  created_at: number
  expires_at: number
  last_active_at: number
  is_current: boolean
}

function parseDevice(ua: string): { icon: 'desktop' | 'mobile' | 'web'; label: string } {
  const lower = ua.toLowerCase()
  if (/electron/i.test(lower)) return { icon: 'desktop', label: 'AAELink Desktop' }
  if (/mobile|android|iphone|ipad/i.test(lower)) return { icon: 'mobile', label: 'Mobile Browser' }
  if (/chrome/i.test(lower)) return { icon: 'web', label: 'Chrome' }
  if (/firefox/i.test(lower)) return { icon: 'web', label: 'Firefox' }
  if (/safari/i.test(lower) && !/chrome/i.test(lower)) return { icon: 'web', label: 'Safari' }
  if (/edg/i.test(lower)) return { icon: 'web', label: 'Edge' }
  return { icon: 'web', label: 'Web Browser' }
}

function relativeTime(ts: number): string {
  if (!ts) return 'Never'
  const diff = Date.now() - ts
  if (diff < 60_000) return 'Just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function parseOS(ua: string): string {
  if (/windows/i.test(ua)) return 'Windows'
  if (/macintosh|mac os/i.test(ua)) return 'macOS'
  if (/linux/i.test(ua)) return 'Linux'
  if (/android/i.test(ua)) return 'Android'
  if (/iphone|ipad/i.test(ua)) return 'iOS'
  return 'Unknown OS'
}

function DeviceIcon({ type }: { type: 'desktop' | 'mobile' | 'web' }) {
  if (type === 'desktop') return <Monitor size={18} />
  if (type === 'mobile') return <Smartphone size={18} />
  return <Globe size={18} />
}

export function SessionManagementPanel() {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [revokingAll, setRevokingAll] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await apiFetch('/api/auth/sessions')
    if (res.ok) {
      const data = (await res.json()) as { sessions: SessionRow[] }
      setSessions(data.sessions || [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  async function revoke(id: string) {
    if (!confirm('Revoke this session? The device will be logged out immediately.')) return
    setRevoking(id)
    const res = await apiFetch(`/api/auth/sessions?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    setRevoking(null)
    if (res.ok) void load()
  }

  async function revokeAll() {
    if (!confirm('Revoke ALL other sessions? Every other device will be logged out.')) return
    setRevokingAll(true)
    const others = sessions.filter(s => !s.is_current)
    for (const s of others) {
      await apiFetch(`/api/auth/sessions?id=${encodeURIComponent(s.id)}`, { method: 'DELETE' })
    }
    setRevokingAll(false)
    void load()
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 24, color: 'var(--mm-muted)' }}>
        <Loader2 size={20} className="spin" /> Loading sessions…
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
          <Shield size={15} style={{ marginRight: 6, verticalAlign: '-2px' }} />
          Active Sessions ({sessions.length})
        </h3>
        {sessions.filter(s => !s.is_current).length > 0 && (
          <button type="button" className="ghost-button ghost-button--danger"
            style={{ fontSize: 12, padding: '4px 10px' }}
            disabled={revokingAll}
            onClick={() => void revokeAll()}>
            {revokingAll ? <><Loader2 size={12} className="spin" /> Revoking…</> : 'Revoke all others'}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sessions.map(s => {
          const device = parseDevice(s.user_agent)
          const os = parseOS(s.user_agent)
          return (
            <div key={s.id} className="session-card" style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
              borderRadius: 8, border: '1px solid var(--mm-border-subtle)',
              background: s.is_current ? 'rgba(61, 184, 135, 0.06)' : 'transparent'
            }}>
              <div style={{ color: s.is_current ? 'var(--mm-online)' : 'var(--mm-muted)', flexShrink: 0 }}>
                <DeviceIcon type={device.icon} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {device.label} · {os}
                  {s.is_current && (
                    <span style={{
                      marginLeft: 8, fontSize: 10, fontWeight: 700, color: 'var(--mm-online)',
                      background: 'rgba(61, 184, 135, 0.12)', padding: '1px 6px', borderRadius: 3
                    }}>
                      THIS DEVICE
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--mm-muted)', marginTop: 2 }}>
                  {s.ip_address || 'Unknown IP'}
                  {' · '}
                  Last active {relativeTime(s.last_active_at || s.created_at)}
                  {' · '}
                  Expires {new Date(s.expires_at).toLocaleDateString(undefined, {
                    month: 'short', day: 'numeric'
                  })}
                </div>
              </div>
              {!s.is_current && (
                <button type="button" className="mm-icon-btn" title="Revoke session"
                  style={{ color: '#d24b4e', flexShrink: 0 }}
                  disabled={revoking === s.id}
                  onClick={() => void revoke(s.id)}>
                  {revoking === s.id ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {sessions.length === 0 && (
        <p style={{ textAlign: 'center', color: 'var(--mm-muted)', fontSize: 13, padding: 16 }}>
          No active sessions found.
        </p>
      )}
    </div>
  )
}
