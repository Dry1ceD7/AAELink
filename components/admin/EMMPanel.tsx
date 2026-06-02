'use client'

import { useCallback, useEffect, useState } from 'react'
import { Smartphone, Bot, Laptop, Monitor, X, Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import { useConfirm } from '@/components/a11y'

/* ─────────────────────────────────────────────────────────────────────
   EMMPanel — Enterprise Mobility Management
   • Device enrollment & compliance policies
   • Remote wipe & lock capabilities
   • App distribution & management
   ───────────────────────────────────────────────────────────────────── */

interface ManagedDevice {
  id: string
  device_name: string
  owner: string
  platform: string
  os_version: string
  app_version: string
  last_seen: string
  compliance: string
  enrolled_at: string
  encrypted: boolean
  passcode_set: boolean
}

const PLATFORM_ICONS: Record<string, React.ComponentType<{ size: number }>> = { ios: Smartphone, android: Bot, macos: Laptop, windows: Monitor }

const complianceConfig: Record<string, { bg: string; text: string; label: string }> = {
  compliant: { bg: '#2bac7620', text: '#2bac76', label: 'Compliant' },
  non_compliant: { bg: '#e01e5a20', text: '#e01e5a', label: 'Non-Compliant' },
  unknown: { bg: '#8b8b8b20', text: '#8b8b8b', label: 'Unknown' },
}

function relativeTime(ts: string | undefined): string {
  if (!ts) return ''
  const d = Date.parse(ts)
  if (isNaN(d)) return ts
  const diff = Date.now() - d
  if (diff < 60_000) return 'Just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function EMMPanel({ onClose }: { onClose: () => void }) {
  const { confirm, confirmDialog } = useConfirm()
  const [devices, setDevices] = useState<ManagedDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'devices' | 'policies' | 'apps'>('devices')
  const [expandedDevice, setExpandedDevice] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filterPlatform, setFilterPlatform] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/admin/devices')
      if (res.ok) {
        const data = (await res.json()) as { devices?: ManagedDevice[] }
        setDevices(data.devices || [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const filtered = devices.filter(d => {
    if (filterPlatform !== 'all' && d.platform !== filterPlatform) return false
    if (search && !d.device_name?.toLowerCase().includes(search.toLowerCase()) && !d.owner?.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  async function lockDevice(id: string) {
    if (!(await confirm({ title: 'Lock device', message: 'Lock this device? The user will be signed out.', confirmLabel: 'Lock' }))) return
    await apiFetch(`/api/admin/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'lock', device_id: id })
    })
    void load()
  }

  async function wipeDevice(id: string) {
    if (!(await confirm({ title: 'Remote wipe device', message: 'REMOTE WIPE this device? This cannot be undone.', danger: true, confirmLabel: 'Wipe' }))) return
    await apiFetch(`/api/admin/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'wipe', device_id: id })
    })
    void load()
  }

  return (
    <>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--mm-main-bg)', color: 'var(--mm-text)' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--mm-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #4361EE, #2B35AF)', display: 'grid', placeItems: 'center', color: '#fff' }}><Smartphone size={18} /></div>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Enterprise Mobility Management</h2>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>Device enrollment, compliance & remote management</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}><X size={18} /></button>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
          {[
            { label: 'Total Devices', value: devices.length, color: '#4361EE' },
            { label: 'Compliant', value: devices.filter(d => d.compliance === 'compliant').length, color: '#2bac76' },
            { label: 'Non-Compliant', value: devices.filter(d => d.compliance === 'non_compliant').length, color: '#e01e5a' },
            { label: 'Platforms', value: new Set(devices.map(d => d.platform)).size, color: '#8b5cf6' },
          ].map(s => (
            <div key={s.label} style={{ padding: 12, borderRadius: 10, border: '1px solid var(--mm-border)', textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 11, opacity: 0.6 }}>{s.label}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 4 }}>
          {(['devices', 'policies', 'apps'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '6px 14px', borderRadius: 8, border: 'none', fontSize: 13,
              fontWeight: tab === t ? 700 : 500, cursor: 'pointer',
              background: tab === t ? '#4361EE' : 'var(--mm-hover-bg)',
              color: tab === t ? '#fff' : 'var(--mm-text)', textTransform: 'capitalize',
            }}>{t === 'devices' ? 'Managed Devices' : t === 'policies' ? 'Policies' : 'App Distribution'}</button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {tab === 'devices' && (
          <>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search devices or owners…" style={{ flex: 1, padding: '10px 14px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13, outline: 'none' }} />
              <select value={filterPlatform} onChange={e => setFilterPlatform(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13 }}>
                <option value="all">All Platforms</option>
                <option value="ios">iOS</option><option value="android">Android</option>
                <option value="macos">macOS</option><option value="windows">Windows</option>
              </select>
            </div>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 24, color: 'var(--mm-muted)' }}><Loader2 size={20} className="spin" /> Loading devices…</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filtered.map(dev => {
                  const comp = complianceConfig[dev.compliance] || complianceConfig.unknown
                  const expanded = expandedDevice === dev.id
                  const Icon = PLATFORM_ICONS[dev.platform] || Laptop
                  return (
                    <div key={dev.id} style={{ borderRadius: 12, border: '1px solid var(--mm-border)', overflow: 'hidden' }}>
                      <div onClick={() => setExpandedDevice(expanded ? null : dev.id)}
                        className="aae-hoverable"
                        aria-expanded={expanded}
                        style={{ padding: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span style={{ display: 'flex' }}><Icon size={24} /></span>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 14 }}>{dev.device_name}</div>
                            <div style={{ fontSize: 12, opacity: 0.6 }}>{dev.owner} · {dev.os_version} · v{dev.app_version} · {relativeTime(dev.last_seen)}</div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, background: comp.bg, color: comp.text, fontWeight: 600 }}>{comp.label}</span>
                          <span className={`aae-chevron-toggle${expanded ? ' aae-chevron-toggle--open' : ''}`} style={{ fontSize: 14, display: 'inline-block' }}>▾</span>
                        </div>
                      </div>
                      {expanded && (
                        <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--mm-border)', fontSize: 13 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
                            <div><span style={{ opacity: 0.5 }}>Encryption:</span> {dev.encrypted ? '✓ Enabled' : '✗ Disabled'}</div>
                            <div><span style={{ opacity: 0.5 }}>Passcode:</span> {dev.passcode_set ? '✓ Set' : '✗ Not set'}</div>
                            <div><span style={{ opacity: 0.5 }}>Enrolled:</span> {dev.enrolled_at}</div>
                            <div><span style={{ opacity: 0.5 }}>App Version:</span> {dev.app_version}</div>
                          </div>
                          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                            <button onClick={(e) => { e.stopPropagation(); void lockDevice(dev.id) }} style={{ background: '#e8912d20', color: '#e8912d', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>Lock Device</button>
                            <button onClick={(e) => { e.stopPropagation(); void wipeDevice(dev.id) }} style={{ background: '#e01e5a20', color: '#e01e5a', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>Remote Wipe</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
                {filtered.length === 0 && !loading && (
                  <div style={{ textAlign: 'center', padding: 24, color: 'var(--mm-muted)', fontSize: 13 }}>No managed devices found.</div>
                )}
              </div>
            )}
          </>
        )}

        {tab === 'policies' && (
          <div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {[
              { label: 'Require device encryption', desc: 'Block access from unencrypted devices', on: true },
              { label: 'Require passcode/biometrics', desc: 'Devices must have screen lock enabled', on: true },
              { label: 'Minimum app version', desc: 'Block devices running outdated AAELink versions', on: false, isSelect: true },
              { label: 'Jailbreak/root detection', desc: 'Block access from jailbroken or rooted devices', on: true },
              { label: 'Auto-lock timeout', desc: 'Force app lock after inactivity', on: false, isSelect: true },
              { label: 'Block screenshots', desc: 'Prevent screenshots on mobile devices', on: false },
              { label: 'Geofencing', desc: 'Restrict access to approved geographic regions', on: false },
            ].map(p => (
              <div key={p.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderRadius: 10, border: '1px solid var(--mm-border)' }}>
                <div><div style={{ fontWeight: 600, fontSize: 14 }}>{p.label}</div><div style={{ fontSize: 12, opacity: 0.6 }}>{p.desc}</div></div>
                {p.isSelect ? (
                  <select style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13 }}>
                    <option>v0.0.3</option><option>v0.0.2</option><option>Any</option>
                  </select>
                ) : (
                  <div style={{ width: 44, height: 24, borderRadius: 12, background: p.on ? '#2bac76' : 'var(--mm-hover-bg)', cursor: 'pointer', position: 'relative' }}>
                    <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: p.on ? 23 : 3 }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === 'apps' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { name: 'AAELink Mobile', version: '0.0.3-alpha', platforms: ['iOS', 'Android'], installs: devices.filter(d => ['ios', 'android'].includes(d.platform)).length, status: 'Published' },
              { name: 'AAELink Desktop', version: '0.0.3-alpha', platforms: ['macOS', 'Windows'], installs: devices.filter(d => ['macos', 'windows'].includes(d.platform)).length, status: 'Published' },
            ].map(app => (
              <div key={app.name} style={{ padding: 16, borderRadius: 12, border: '1px solid var(--mm-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: 'linear-gradient(135deg, #12086F, #4361EE)', display: 'grid', placeItems: 'center', color: '#fff', fontSize: 18, fontWeight: 700 }}>A</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{app.name}</div>
                    <div style={{ fontSize: 12, opacity: 0.6 }}>v{app.version} · {app.platforms.join(', ')} · {app.installs} installs</div>
                  </div>
                </div>
                <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, background: app.status === 'Published' ? '#2bac7620' : '#8b5cf620', color: app.status === 'Published' ? '#2bac76' : '#8b5cf6', fontWeight: 600 }}>{app.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
    {confirmDialog}
    </>
  )
}
