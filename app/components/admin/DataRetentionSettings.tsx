'use client'

import { useState } from 'react'
import { FolderCog, AlertTriangle, X } from 'lucide-react'

/* ─────────────────────────────────────────────────────────────────────
   DataRetentionSettings — Enterprise compliance controls
   • Global & per-channel retention policies
   • Auto-delete messages/files after N days
   • Legal hold override management
   ───────────────────────────────────────────────────────────────────── */

interface RetentionPolicy {
  id: string
  scope: 'global' | 'channel' | 'dm'
  name: string
  messageDays: number | null // null = keep forever
  fileDays: number | null
  isActive: boolean
  channelId?: string
}

export default function DataRetentionSettings({ onClose }: { onClose: () => void }) {
  const [policies, setPolicies] = useState<RetentionPolicy[]>([
    { id: '1', scope: 'global', name: 'Default — All Channels', messageDays: null, fileDays: null, isActive: true },
    { id: '2', scope: 'channel', name: '#finance', messageDays: 90, fileDays: 90, isActive: true, channelId: 'ch_finance' },
    { id: '3', scope: 'channel', name: '#legal-team', messageDays: null, fileDays: null, isActive: true, channelId: 'ch_legal' },
    { id: '4', scope: 'dm', name: 'All Direct Messages', messageDays: 365, fileDays: 365, isActive: false },
  ])
  const [showNewPolicy, setShowNewPolicy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const togglePolicy = (id: string) => {
    setPolicies(prev => prev.map(p => p.id === id ? { ...p, isActive: !p.isActive } : p))
  }

  const updatePolicy = (id: string, updates: Partial<RetentionPolicy>) => {
    setPolicies(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p))
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--mm-main-bg)', color: 'var(--mm-text)',
      animation: 'slack-slide-up 200ms var(--slack-ease-out) forwards',
    }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--mm-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FolderCog size={18} />
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Data Retention Policies</h2>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}><X size={18} /></button>
        </div>
        <p style={{ fontSize: 13, opacity: 0.6, margin: '8px 0 0', lineHeight: 1.5 }}>
          Control how long messages and files are retained. Policies override defaults on a per-channel basis.
          Legal holds take precedence over all retention policies.
        </p>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {/* Warning */}
        <div style={{
          background: 'rgba(232,168,32,0.08)', border: '1px solid rgba(232,168,32,0.2)',
          borderRadius: 12, padding: 14, marginBottom: 20,
          display: 'flex', gap: 10, fontSize: 13, lineHeight: 1.5,
        }}>
          <span style={{ display: 'flex', flexShrink: 0 }}><AlertTriangle size={16} style={{ color: '#e8a820' }} /></span>
          <div>
            <strong>Caution:</strong> Reducing retention periods will permanently delete messages and files
            older than the new threshold. This action cannot be undone. Ensure legal holds are in place
            before modifying policies.
          </div>
        </div>

        {/* Policies */}
        {policies.map(policy => (
          <div key={policy.id} style={{
            border: '1px solid var(--mm-border)', borderRadius: 12,
            padding: 16, marginBottom: 12, background: 'var(--mm-rhs-bg)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 6,
                  background: policy.scope === 'global' ? 'rgba(67,97,238,0.12)' : policy.scope === 'channel' ? 'rgba(43,172,118,0.12)' : 'rgba(232,168,32,0.12)',
                  color: policy.scope === 'global' ? '#4361EE' : policy.scope === 'channel' ? '#2bac76' : '#e8a820',
                  fontWeight: 600, textTransform: 'uppercase',
                }}>{policy.scope}</span>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{policy.name}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button onClick={() => setEditingId(editingId === policy.id ? null : policy.id)} style={{
                  background: 'none', border: '1px solid var(--mm-border)',
                  borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer',
                  color: 'var(--mm-muted)',
                }}>Edit</button>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={policy.isActive}
                    onChange={() => togglePolicy(policy.id)}
                    style={{ accentColor: '#4361EE' }} />
                  <span style={{ fontSize: 12 }}>Active</span>
                </label>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ fontSize: 13 }}>
                <span style={{ opacity: 0.5 }}>Messages: </span>
                <span style={{ fontWeight: 600 }}>
                  {policy.messageDays === null ? 'Keep forever' : `${policy.messageDays} days`}
                </span>
              </div>
              <div style={{ fontSize: 13 }}>
                <span style={{ opacity: 0.5 }}>Files: </span>
                <span style={{ fontWeight: 600 }}>
                  {policy.fileDays === null ? 'Keep forever' : `${policy.fileDays} days`}
                </span>
              </div>
            </div>

            {editingId === policy.id && (
              <div style={{
                marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--mm-border)',
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
                animation: 'slack-slide-up 150ms var(--slack-ease-bounce) forwards',
              }}>
                <div>
                  <label style={{ fontSize: 12, opacity: 0.6, display: 'block', marginBottom: 4 }}>Message retention (days)</label>
                  <select value={policy.messageDays === null ? 'forever' : String(policy.messageDays)}
                    onChange={e => updatePolicy(policy.id, { messageDays: e.target.value === 'forever' ? null : parseInt(e.target.value) })}
                    style={{
                      width: '100%', border: '1px solid var(--mm-border)', borderRadius: 8,
                      padding: '8px 10px', fontSize: 13, background: 'var(--mm-main-bg)',
                      color: 'var(--mm-text)', cursor: 'pointer',
                    }}>
                    <option value="forever">Keep forever</option>
                    <option value="30">30 days</option>
                    <option value="90">90 days</option>
                    <option value="180">180 days</option>
                    <option value="365">1 year</option>
                    <option value="730">2 years</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, opacity: 0.6, display: 'block', marginBottom: 4 }}>File retention (days)</label>
                  <select value={policy.fileDays === null ? 'forever' : String(policy.fileDays)}
                    onChange={e => updatePolicy(policy.id, { fileDays: e.target.value === 'forever' ? null : parseInt(e.target.value) })}
                    style={{
                      width: '100%', border: '1px solid var(--mm-border)', borderRadius: 8,
                      padding: '8px 10px', fontSize: 13, background: 'var(--mm-main-bg)',
                      color: 'var(--mm-text)', cursor: 'pointer',
                    }}>
                    <option value="forever">Keep forever</option>
                    <option value="30">30 days</option>
                    <option value="90">90 days</option>
                    <option value="180">180 days</option>
                    <option value="365">1 year</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        ))}

        <button onClick={() => setShowNewPolicy(!showNewPolicy)} style={{
          width: '100%', padding: '12px', borderRadius: 12,
          border: '1px dashed var(--mm-border)', background: 'none',
          cursor: 'pointer', color: 'var(--mm-muted)', fontSize: 13,
        }}>
          + Add channel-specific policy
        </button>
      </div>
    </div>
  )
}
