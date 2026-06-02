'use client'

import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Cloud, Diamond, Hexagon, Lock, RotateCcw, Eye, Sparkles, FileText, Plus, X } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import { useConfirm } from '@/components/a11y'
import { EmptyState, Modal, SkeletonStack, Surface, Toggle } from '@/components/primitives'

/* ─────────────────────────────────────────────────────────────────────
   EKMPanel — Enterprise Key Management
   • Customer-managed encryption keys (BYOK)
   • Key rotation & revocation controls
   • Audit trail for key operations
   ───────────────────────────────────────────────────────────────────── */

interface EncryptionKey {
  id: string
  name: string
  provider: string
  key_id: string
  status: string
  created_at: string
  last_rotated: string
  expires_at?: string
  scope: string[]
}

interface KeyEvent {
  id: string
  action: string
  key_name: string
  actor: string
  timestamp: string
  details: string
}

const PROVIDERS = [
  { id: 'aws_kms', name: 'AWS KMS', iconKey: 'cloud', desc: 'Amazon Key Management Service' },
  { id: 'azure_keyvault', name: 'Azure Key Vault', iconKey: 'diamond', desc: 'Microsoft Azure Key Vault' },
  { id: 'gcp_kms', name: 'GCP Cloud KMS', iconKey: 'hexagon', desc: 'Google Cloud Key Management' },
  { id: 'custom', name: 'Custom HSM', iconKey: 'lock', desc: 'Self-managed HSM endpoint' },
]

const PROVIDER_ICON_MAP: Record<string, React.ComponentType<{ size: number }>> = {
  cloud: Cloud, diamond: Diamond, hexagon: Hexagon, lock: Lock,
}

const statusColors: Record<string, { bg: string; text: string }> = {
  active: { bg: '#2bac7620', text: '#2bac76' },
  rotating: { bg: '#e8912d20', text: '#e8912d' },
  revoked: { bg: '#e01e5a20', text: '#e01e5a' },
  pending: { bg: '#8b5cf620', text: '#8b5cf6' },
}

export default function EKMPanel({ onClose }: { onClose: () => void }) {
  const { confirm, confirmDialog } = useConfirm()
  const [keys, setKeys] = useState<EncryptionKey[]>([])
  const [events, setEvents] = useState<KeyEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'keys' | 'audit' | 'settings'>('keys')
  const [showAddKey, setShowAddKey] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState('')
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  // Settings tab — local toggle state (placeholder; not yet persisted to API)
  const [ekmSettings, setEkmSettings] = useState<Record<string, boolean>>({
    'Auto-rotate keys': true,
    'Require approval for revocation': true,
    'Log all decrypt operations': false,
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/admin/encryption')
      if (res.ok) {
        const data = await res.json() as { keys?: EncryptionKey[]; audit_events?: KeyEvent[]; config?: Record<string, unknown> }
        setKeys(data.keys || [])
        setEvents(data.audit_events || [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function rotateKey(id: string) {
    if (!(await confirm({ title: 'Rotate key', message: 'Rotate this encryption key? Active sessions will be re-encrypted.', confirmLabel: 'Rotate' }))) return
    await apiFetch('/api/admin/encryption', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rotate_key', key_id: id }),
    })
    void load()
  }

  async function revokeKey(id: string) {
    if (!(await confirm({ title: 'Revoke key', message: 'REVOKE this key? This is irreversible and may cause data loss.', danger: true, confirmLabel: 'Revoke' }))) return
    await apiFetch('/api/admin/encryption', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'revoke_key', key_id: id }),
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
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #8b5cf6, #6366f1)', display: 'grid', placeItems: 'center', color: '#fff' }}><KeyRound size={18} /></div>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Enterprise Key Management</h2>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>Customer-managed encryption keys (BYOK)</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowAddKey(true)} style={{ background: 'linear-gradient(135deg, #8b5cf6, #6366f1)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}><Plus size={13} /> Add Key</button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}><X size={18} /></button>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
          {[
            { label: 'Active Keys', value: keys.filter(k => k.status === 'active').length, color: '#2bac76' },
            { label: 'Providers', value: new Set(keys.map(k => k.provider)).size, color: '#4361EE' },
            { label: 'Key Events', value: events.length, color: '#e8912d' },
            { label: 'Total Keys', value: keys.length, color: '#8b5cf6' },
          ].map(s => (
            <Surface key={s.label} bordered padded="sm" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 11, opacity: 0.6 }}>{s.label}</div>
            </Surface>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4 }}>
          {(['keys', 'audit', 'settings'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '6px 14px', borderRadius: 8, border: 'none', fontSize: 13,
              fontWeight: tab === t ? 700 : 500, cursor: 'pointer',
              background: tab === t ? '#8b5cf6' : 'var(--mm-hover-bg)',
              color: tab === t ? '#fff' : 'var(--mm-text)', textTransform: 'capitalize',
            }}>{t === 'keys' ? 'Encryption Keys' : t === 'audit' ? 'Key Audit Log' : 'Settings'}</button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {loading ? (
          <SkeletonStack count={3} variant="card" />
        ) : (
          <>
            {tab === 'keys' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {keys.length === 0 ? (
                  <EmptyState
                    icon={<KeyRound size={40} aria-hidden="true" />}
                    title="No encryption keys configured"
                    description="Add a customer-managed key (BYOK) from AWS KMS, Azure Key Vault, GCP Cloud KMS, or a custom HSM to take control of workspace encryption."
                  />
                ) : keys.map(key => {
                  const prov = PROVIDERS.find(p => p.id === key.provider)
                  const st = statusColors[key.status] || statusColors.pending
                  const expanded = expandedKey === key.id
                  return (
                    <div key={key.id} style={{ borderRadius: 12, border: '1px solid var(--mm-border)', overflow: 'hidden' }}>
                      <div onClick={() => setExpandedKey(expanded ? null : key.id)}
                        className="aae-hoverable"
                        aria-expanded={expanded}
                        style={{
                          padding: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span style={{ display: 'flex' }}>{(() => { const Icon = PROVIDER_ICON_MAP[prov?.iconKey ?? '']; return Icon ? <Icon size={22} /> : null; })()}</span>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 14 }}>{key.name}</div>
                            <div style={{ fontSize: 12, opacity: 0.6 }}>{prov?.name || key.provider} · Rotated {key.last_rotated || 'Never'}</div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {(key.scope || []).map(s => (
                              <span key={s} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 6, background: 'var(--mm-hover-bg)', textTransform: 'capitalize' }}>{s}</span>
                            ))}
                          </div>
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8, background: st.bg, color: st.text, fontWeight: 600, textTransform: 'capitalize' }}>{key.status}</span>
                          <span className={`aae-chevron-toggle${expanded ? ' aae-chevron-toggle--open' : ''}`} style={{ fontSize: 14, display: 'inline-block' }}>▾</span>
                        </div>
                      </div>
                      {expanded && (
                        <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--mm-border)', fontSize: 13 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
                            <div><span style={{ opacity: 0.5 }}>Key ID:</span> <code style={{ fontSize: 11 }}>{key.key_id}</code></div>
                            <div><span style={{ opacity: 0.5 }}>Created:</span> {key.created_at}</div>
                            <div><span style={{ opacity: 0.5 }}>Last Rotated:</span> {key.last_rotated || 'Never'}</div>
                            {key.expires_at && <div><span style={{ opacity: 0.5 }}>Expires:</span> {key.expires_at}</div>}
                          </div>
                          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                            <button onClick={(e) => { e.stopPropagation(); void rotateKey(key.id) }} style={{ background: '#e8912d', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>Rotate Now</button>
                            <button style={{ background: 'var(--mm-hover-bg)', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: 'pointer', color: 'var(--mm-text)' }}>View Usage</button>
                            <button onClick={(e) => { e.stopPropagation(); void revokeKey(key.id) }} style={{ background: '#e01e5a20', color: '#e01e5a', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>Revoke</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {tab === 'audit' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {events.length === 0 ? (
                  <EmptyState
                    icon={<FileText size={40} aria-hidden="true" />}
                    title="No key audit events yet"
                    description="Key creation, rotation, and revocation events will appear here once you start using customer-managed keys."
                  />
                ) : events.map(ev => (
                  <div key={ev.id} style={{ padding: 14, borderRadius: 10, border: '1px solid var(--mm-border)', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--mm-hover-bg)', display: 'grid', placeItems: 'center', fontSize: 16, flexShrink: 0 }}>
                      {(() => { if (ev.action.includes('rotated')) return <RotateCcw size={16} />; if (ev.action.includes('accessed')) return <Eye size={16} />; if (ev.action.includes('created')) return <Sparkles size={16} />; return <FileText size={16} />; })()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{ev.action.replace('key.', '').replace('_', ' ')}</div>
                      <div style={{ fontSize: 12, opacity: 0.6 }}>{ev.key_name} · {ev.actor} · {ev.details}</div>
                    </div>
                    <span style={{ fontSize: 11, opacity: 0.5 }}>{ev.timestamp}</span>
                  </div>
                ))}
              </div>
            )}

            {tab === 'settings' && (
              <div style={{ maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 20 }}>
                {[
                  { label: 'Auto-rotate keys', desc: 'Automatically rotate encryption keys on a schedule' },
                  { label: 'Rotation interval', desc: 'Days between automatic key rotations', isSelect: true },
                  { label: 'Require approval for revocation', desc: 'Key revocation requires a second admin approval' },
                  { label: 'Log all decrypt operations', desc: 'Record every decryption operation in the audit log' },
                ].map(s => {
                  const labelId = `ekm-setting-${s.label.replace(/\s+/g, '-').toLowerCase()}`
                  return (
                    <Surface key={s.label} bordered padded="md" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <div id={labelId} style={{ fontWeight: 600, fontSize: 14 }}>{s.label}</div>
                        <div style={{ fontSize: 12, opacity: 0.6 }}>{s.desc}</div>
                      </div>
                      {s.isSelect ? (
                        <select aria-labelledby={labelId} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13 }}>
                          <option>30 days</option><option>60 days</option><option>90 days</option><option>180 days</option><option>365 days</option>
                        </select>
                      ) : (
                        <Toggle
                          checked={ekmSettings[s.label] ?? false}
                          onChange={next => setEkmSettings(prev => ({ ...prev, [s.label]: next }))}
                          labelledBy={labelId}
                        />
                      )}
                    </Surface>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Add Key Modal */}
      <Modal
        open={showAddKey}
        onClose={() => { setShowAddKey(false); setSelectedProvider('') }}
        title="Add Encryption Key"
        footer={
          <>
            <button
              onClick={() => { setShowAddKey(false); setSelectedProvider('') }}
              style={{ background: 'var(--mm-hover-bg)', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', color: 'var(--mm-text)', fontSize: 13 }}
            >
              Cancel
            </button>
            <button
              onClick={() => { setShowAddKey(false); setSelectedProvider('') }}
              disabled={!selectedProvider}
              style={{ background: '#8b5cf6', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: selectedProvider ? 'pointer' : 'not-allowed', opacity: selectedProvider ? 1 : 0.5 }}
            >
              Continue Setup
            </button>
          </>
        }
      >
        <p style={{ fontSize: 13, opacity: 0.6, marginTop: 0, marginBottom: 16 }}>Select a cloud KMS provider to connect your customer-managed key.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {PROVIDERS.map(p => (
            <button key={p.id} onClick={() => setSelectedProvider(p.id)} style={{
              padding: 14, borderRadius: 10, border: selectedProvider === p.id ? '2px solid #8b5cf6' : '1px solid var(--mm-border)',
              background: selectedProvider === p.id ? '#8b5cf608' : 'var(--mm-main-bg)',
              display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', textAlign: 'left',
            }}>
              <span style={{ display: 'flex' }}>{(() => { const Icon = PROVIDER_ICON_MAP[p.iconKey]; return Icon ? <Icon size={22} /> : null; })()}</span>
              <div><div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div><div style={{ fontSize: 12, opacity: 0.6 }}>{p.desc}</div></div>
            </button>
          ))}
        </div>
      </Modal>
    </div>
    {confirmDialog}
    </>
  )
}
