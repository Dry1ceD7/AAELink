'use client'

import { useCallback, useEffect, useState } from 'react'
import { Monitor, Smartphone, Globe, Trash2, Shield, Loader2, X } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import { useConfirm } from '@/components/a11y'

/* ── Session Management — View & revoke active sessions (admin module) ─ */

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

function parseOS(ua: string): string {
  if (/windows/i.test(ua)) return 'Windows'
  if (/macintosh|mac os/i.test(ua)) return 'macOS'
  if (/linux/i.test(ua)) return 'Linux'
  if (/android/i.test(ua)) return 'Android'
  if (/iphone|ipad/i.test(ua)) return 'iOS'
  return 'Unknown OS'
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

function DeviceIcon({ type }: { type: 'desktop' | 'mobile' | 'web' }) {
  if (type === 'desktop') return <Monitor size={18} />
  if (type === 'mobile') return <Smartphone size={18} />
  return <Globe size={18} />
}

export default function SessionManagementPanel({ onClose }: { onClose: () => void }) {
  const { confirm, confirmDialog } = useConfirm()
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
    if (!(await confirm({ title: 'Revoke session', message: 'Revoke this session? The device will be logged out immediately.', danger: true, confirmLabel: 'Revoke' }))) return
    setRevoking(id)
    const res = await apiFetch(`/api/auth/sessions?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    setRevoking(null)
    if (res.ok) void load()
  }

  async function revokeAll() {
    if (!(await confirm({ title: 'Revoke all sessions', message: 'Revoke ALL other sessions? Every other device will be logged out.', danger: true, confirmLabel: 'Revoke all' }))) return
    setRevokingAll(true)
    const others = sessions.filter(s => !s.is_current)
    for (const s of others) {
      await apiFetch(`/api/auth/sessions?id=${encodeURIComponent(s.id)}`, { method: 'DELETE' })
    }
    setRevokingAll(false)
    void load()
  }

  // Compute stats
  const activeNow = sessions.filter(s => {
    if (s.is_current) return true
    const diff = Date.now() - (s.last_active_at || s.created_at)
    return diff < 600_000 // active within 10 minutes
  }).length
  const uniqueIPs = new Set(sessions.map(s => s.ip_address).filter(Boolean)).size

  return (
    <>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--mm-main-bg)', color: 'var(--mm-text)' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--mm-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #06b6d4, #0891b2)', display: 'grid', placeItems: 'center' }}><Monitor size={18} color="#fff" /></div>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Active Sessions</h2>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>{sessions.length} active session{sessions.length !== 1 ? 's' : ''} across your workspace</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {sessions.filter(s => !s.is_current).length > 0 && (
              <button onClick={() => void revokeAll()} disabled={revokingAll}
                style={{ background: '#e01e5a20', color: '#e01e5a', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
                {revokingAll ? <><Loader2 size={12} className="spin" /> Revoking…</> : 'Revoke All Others'}
              </button>
            )}
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}><X size={18} /></button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {[
            { label: 'Active Now', value: activeNow, color: '#2bac76' },
            { label: 'Unique IPs', value: uniqueIPs, color: '#4361EE' },
            { label: 'Total', value: sessions.length, color: '#e8912d' },
          ].map(s => (
            <div key={s.label} style={{ padding: 12, borderRadius: 10, border: '1px solid var(--mm-border)', textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 11, opacity: 0.6 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--mm-muted)' }}>
            <Loader2 size={20} className="spin" /> Loading sessions…
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sessions.map(session => {
              const device = parseDevice(session.user_agent)
              const os = parseOS(session.user_agent)
              return (
                <div key={session.id} style={{
                  padding: 14, borderRadius: 12,
                  border: session.is_current ? '2px solid #2bac76' : '1px solid var(--mm-border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ display: 'flex', color: session.is_current ? 'var(--mm-online)' : 'var(--mm-muted)' }}>
                      <DeviceIcon type={device.icon} />
                    </span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {device.label} · {os}
                        {session.is_current && (
                          <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 6, background: '#2bac7620', color: '#2bac76', fontWeight: 700 }}>
                            THIS DEVICE
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.6 }}>
                        {session.ip_address || 'Unknown IP'}
                        {' · '}
                        Last active {relativeTime(session.last_active_at || session.created_at)}
                      </div>
                      <div style={{ fontSize: 11, opacity: 0.4, marginTop: 2 }}>
                        Expires {new Date(session.expires_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </div>
                    </div>
                  </div>
                  {!session.is_current && (
                    <button type="button" className="mm-icon-btn" title="Revoke session"
                      style={{ color: '#d24b4e', flexShrink: 0 }}
                      disabled={revoking === session.id}
                      onClick={() => void revoke(session.id)}>
                      {revoking === session.id ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                    </button>
                  )}
                </div>
              )
            })}
            {sessions.length === 0 && (
              <p style={{ textAlign: 'center', color: 'var(--mm-muted)', fontSize: 13, padding: 16 }}>
                No active sessions found.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
    {confirmDialog}
    </>
  )
}
