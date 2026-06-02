'use client'

import { useState } from 'react'
import { ShieldCheck, MessageCircle, Megaphone, FolderOpen, Headphones, Ban, Plus, X } from 'lucide-react'

/* ─────────────────────────────────────────────────────────────────────
   InformationBarriers — Enterprise compliance walls
   • Prevent specific groups from communicating
   • Block DMs, channels, and file sharing between groups
   • Audit barrier violations
   ───────────────────────────────────────────────────────────────────── */

interface BarrierRule {
  id: string
  name: string
  groupA: { name: string; members: number }
  groupB: { name: string; members: number }
  blockedActions: ('dm' | 'channel' | 'file' | 'huddle')[]
  isActive: boolean
  createdBy: string
  createdAt: string
  violations: number
}

export default function InformationBarriers({ onClose }: { onClose: () => void }) {
  const [barriers, setBarriers] = useState<BarrierRule[]>([
    {
      id: '1', name: 'Investment Banking ↔ Advisory',
      groupA: { name: 'Investment Banking', members: 12 },
      groupB: { name: 'Advisory Services', members: 8 },
      blockedActions: ['dm', 'channel', 'file', 'huddle'],
      isActive: true, createdBy: 'Admin', createdAt: '2026-04-01', violations: 3,
    },
    {
      id: '2', name: 'Sales ↔ Compliance',
      groupA: { name: 'Sales Team', members: 15 },
      groupB: { name: 'Compliance Team', members: 5 },
      blockedActions: ['dm', 'file'],
      isActive: true, createdBy: 'Admin', createdAt: '2026-03-15', violations: 0,
    },
    {
      id: '3', name: 'External Contractors ↔ Finance',
      groupA: { name: 'External Contractors', members: 20 },
      groupB: { name: 'Finance Department', members: 10 },
      blockedActions: ['dm', 'channel', 'file', 'huddle'],
      isActive: false, createdBy: 'Admin', createdAt: '2026-02-20', violations: 1,
    },
  ])

  const toggleBarrier = (id: string) => {
    setBarriers(prev => prev.map(b => b.id === id ? { ...b, isActive: !b.isActive } : b))
  }

  const ACTION_LABELS: Record<string, { label: string; iconKey: string }> = {
    dm: { label: 'Direct Messages', iconKey: 'message' },
    channel: { label: 'Shared Channels', iconKey: 'megaphone' },
    file: { label: 'File Sharing', iconKey: 'folder' },
    huddle: { label: 'Huddles', iconKey: 'headphones' },
  }

  const ACTION_ICON_MAP: Record<string, React.ComponentType<{ size: number }>> = {
    message: MessageCircle, megaphone: Megaphone, folder: FolderOpen, headphones: Headphones,
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
            <ShieldCheck size={18} />
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Information Barriers</h2>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{
              background: '#4361EE', border: 'none', borderRadius: 8,
              padding: '8px 16px', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>+ New Barrier</button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}><X size={18} /></button>
          </div>
        </div>
        <p style={{ fontSize: 13, opacity: 0.6, margin: '8px 0 0', lineHeight: 1.5 }}>
          Information barriers restrict communication between groups to meet regulatory requirements (FINRA, SEC, GDPR).
          Blocked actions are enforced at the API level and cannot be circumvented by users.
        </p>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {barriers.map(barrier => (
          <div key={barrier.id} style={{
            border: '1px solid var(--mm-border)', borderRadius: 12,
            padding: 16, marginBottom: 14, background: 'var(--mm-rhs-bg)',
            opacity: barrier.isActive ? 1 : 0.6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>{barrier.name}</div>
                <div style={{ fontSize: 12, opacity: 0.5 }}>
                  Created by {barrier.createdBy} · {barrier.createdAt}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {barrier.violations > 0 && (
                  <span style={{
                    fontSize: 11, padding: '3px 8px', borderRadius: 6,
                    background: 'rgba(224,30,90,0.1)', color: '#e01e5a', fontWeight: 600,
                  }}>
                    {barrier.violations} violation{barrier.violations !== 1 ? 's' : ''}
                  </span>
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={barrier.isActive}
                    onChange={() => toggleBarrier(barrier.id)}
                    style={{ accentColor: '#4361EE' }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: barrier.isActive ? '#2bac76' : '#e01e5a' }}>
                    {barrier.isActive ? 'Active' : 'Disabled'}
                  </span>
                </label>
              </div>
            </div>

            {/* Visual barrier representation */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{
                flex: 1, background: 'rgba(67,97,238,0.06)', borderRadius: 10, padding: 12,
                textAlign: 'center',
              }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{barrier.groupA.name}</div>
                <div style={{ fontSize: 11, opacity: 0.5 }}>{barrier.groupA.members} members</div>
              </div>
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              }}>
                <span style={{ display: 'flex' }}><Ban size={20} color="#e01e5a" /></span>
                <span style={{ fontSize: 10, opacity: 0.4 }}>BLOCKED</span>
              </div>
              <div style={{
                flex: 1, background: 'rgba(224,30,90,0.06)', borderRadius: 10, padding: 12,
                textAlign: 'center',
              }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{barrier.groupB.name}</div>
                <div style={{ fontSize: 11, opacity: 0.5 }}>{barrier.groupB.members} members</div>
              </div>
            </div>

            {/* Blocked actions */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {barrier.blockedActions.map(action => (
                <span key={action} style={{
                  fontSize: 11, padding: '4px 10px', borderRadius: 6,
                  background: 'rgba(224,30,90,0.06)', color: '#e01e5a',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  {(() => { const Icon = ACTION_ICON_MAP[ACTION_LABELS[action]?.iconKey]; return Icon ? <Icon size={11} /> : null; })()} {ACTION_LABELS[action]?.label}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
