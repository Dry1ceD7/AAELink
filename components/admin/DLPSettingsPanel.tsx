'use client'

import { useCallback, useEffect, useState } from 'react'
import { User, CreditCard, KeyRound, Hospital, Settings, ShieldCheck, Plus, X, Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'

/* ─────────────────────────────────────────────────────────────────────
   DLPSettingsPanel — Data Loss Prevention
   • Scan messages/files for sensitive data patterns
   • Auto-block or flag violations
   • Pattern management (SSN, credit cards, API keys, etc.)
   ───────────────────────────────────────────────────────────────────── */

interface DLPRule {
  id: string
  name: string
  description: string
  pattern: string
  category: string
  action: string
  is_active: boolean
  match_count: number
  last_triggered?: string
}

const CATEGORY_CONFIG: Record<string, { label: string; color: string; iconKey: string }> = {
  pii: { label: 'Personal Info', color: '#e01e5a', iconKey: 'user' },
  financial: { label: 'Financial', color: '#e8a820', iconKey: 'credit-card' },
  credentials: { label: 'Credentials', color: '#4361EE', iconKey: 'key' },
  health: { label: 'Health/HIPAA', color: '#2bac76', iconKey: 'hospital' },
  custom: { label: 'Custom', color: '#616061', iconKey: 'settings' },
}

const CAT_ICON_MAP: Record<string, React.ComponentType<{ size: number }>> = {
  user: User, 'credit-card': CreditCard, key: KeyRound, hospital: Hospital, settings: Settings,
}

const ACTION_CONFIG: Record<string, { label: string; color: string }> = {
  block: { label: 'Block & Delete', color: '#e01e5a' },
  flag: { label: 'Flag for Review', color: '#e8a820' },
  redact: { label: 'Auto-Redact', color: '#4361EE' },
  notify: { label: 'Notify Admin', color: '#616061' },
  warn: { label: 'Warn Sender', color: '#e8912d' },
  log: { label: 'Log Only', color: '#8b8b8b' },
}

export default function DLPSettingsPanel({ onClose }: { onClose: () => void }) {
  const [rules, setRules] = useState<DLPRule[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewRule, setShowNewRule] = useState(false)

  // New rule form
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formPattern, setFormPattern] = useState('')
  const [formCategory, setFormCategory] = useState('custom')
  const [formAction, setFormAction] = useState('flag')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/compliance/dlp')
      if (res.ok) {
        const data = await res.json() as { rules?: DLPRule[] }
        setRules(data.rules || [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const toggleRule = async (id: string, currentActive: boolean) => {
    await apiFetch('/api/compliance/dlp', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle_rule', rule_id: id, is_active: !currentActive }),
    })
    setRules(prev => prev.map(r => r.id === id ? { ...r, is_active: !currentActive } : r))
  }

  const createRule = async () => {
    if (!formName || !formPattern) return
    await apiFetch('/api/compliance/dlp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: formName,
        description: formDesc,
        pattern: formPattern,
        category: formCategory,
        action: formAction,
      }),
    })
    setShowNewRule(false)
    setFormName(''); setFormDesc(''); setFormPattern('')
    void load()
  }

  const totalDetections = rules.filter(r => r.is_active).reduce((sum, r) => sum + (r.match_count || 0), 0)

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--mm-main-bg)', color: 'var(--mm-text)',
      animation: 'slack-slide-up 200ms var(--slack-ease-out) forwards',
    }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--mm-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #4361EE, #2B35AF)', display: 'grid', placeItems: 'center', color: '#fff' }}>
              <ShieldCheck size={18} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>Data Loss Prevention</h2>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>Content scanning rules & policies</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowNewRule(!showNewRule)} style={{
              background: '#4361EE', border: 'none', borderRadius: 8,
              padding: '8px 16px', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 4,
            }}><Plus size={13} /> New Rule</button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}><X size={18} /></button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12,
        padding: '16px 20px', borderBottom: '1px solid var(--mm-border)',
      }}>
        {[
          { label: 'Active Rules', value: rules.filter(r => r.is_active).length, color: '#2bac76' },
          { label: 'Total Detections', value: totalDetections, color: '#e8a820' },
          { label: 'Rules', value: rules.length, color: '#4361EE' },
        ].map(stat => (
          <div key={stat.label} style={{
            background: 'var(--mm-rhs-bg)', borderRadius: 10, padding: 14,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: stat.color }}>{stat.value}</div>
            <div style={{ fontSize: 11, opacity: 0.5 }}>{stat.label}</div>
          </div>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--mm-muted)' }}><Loader2 size={20} className="spin" /> Loading DLP rules…</div>
        ) : rules.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, opacity: 0.5, fontSize: 13 }}>No DLP rules configured. Add rules to scan messages and files for sensitive content.</div>
        ) : rules.map(rule => {
          const cat = CATEGORY_CONFIG[rule.category] || CATEGORY_CONFIG.custom
          const action = ACTION_CONFIG[rule.action] || ACTION_CONFIG.flag
          return (
            <div key={rule.id} style={{
              border: '1px solid var(--mm-border)', borderRadius: 12,
              padding: 16, marginBottom: 12, background: 'var(--mm-rhs-bg)',
              opacity: rule.is_active ? 1 : 0.6,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    fontSize: 10, padding: '2px 8px', borderRadius: 6,
                    background: `${cat.color}18`, color: cat.color, fontWeight: 600,
                  }}>{(() => { const Icon = CAT_ICON_MAP[cat.iconKey]; return Icon ? <Icon size={10} /> : null; })()} {cat.label}</span>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{rule.name}</span>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={rule.is_active}
                    onChange={() => void toggleRule(rule.id, rule.is_active)}
                    style={{ accentColor: '#4361EE' }} />
                  <span style={{ fontSize: 12 }}>{rule.is_active ? 'On' : 'Off'}</span>
                </label>
              </div>

              <div style={{ fontSize: 13, opacity: 0.6, marginBottom: 8 }}>{rule.description}</div>

              <div style={{
                display: 'flex', alignItems: 'center', gap: 12, fontSize: 12,
              }}>
                <span style={{
                  padding: '3px 8px', borderRadius: 6,
                  background: `${action.color}18`, color: action.color, fontWeight: 600,
                }}>
                  Action: {action.label}
                </span>
                <span style={{ opacity: 0.5 }}>{rule.match_count || 0} detection{(rule.match_count || 0) !== 1 ? 's' : ''}</span>
                {rule.last_triggered && (
                  <span style={{ opacity: 0.4 }}>Last: {rule.last_triggered}</span>
                )}
              </div>

              <div style={{
                marginTop: 8, fontSize: 11, fontFamily: 'JetBrains Mono, Menlo, monospace',
                background: 'var(--mm-hover-bg)', padding: '6px 10px', borderRadius: 6,
                color: 'var(--mm-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                Pattern: {rule.pattern}
              </div>
            </div>
          )
        })}
      </div>

      {/* New Rule Modal */}
      {showNewRule && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 3000, display: 'grid', placeItems: 'center', animation: 'slack-modal-in 200ms var(--slack-ease-bounce) forwards' }} onClick={() => setShowNewRule(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--mm-main-bg)', borderRadius: 16, padding: 24, width: 460, boxShadow: 'var(--slack-shadow-modal)' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 800 }}>Create DLP Rule</h3>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>Rule Name</label>
              <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g., Thai National ID" style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>Description</label>
              <input value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="What does this rule detect?" style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>Regex Pattern</label>
              <input value={formPattern} onChange={e => setFormPattern(e.target.value)} placeholder="\\b\\d{3}-\\d{2}-\\d{4}\\b" style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'JetBrains Mono, monospace' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>Category</label>
                <select value={formCategory} onChange={e => setFormCategory(e.target.value)} style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13 }}>
                  {Object.entries(CATEGORY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>Action</label>
                <select value={formAction} onChange={e => setFormAction(e.target.value)} style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13 }}>
                  {Object.entries(ACTION_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowNewRule(false)} style={{ background: 'var(--mm-hover-bg)', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', color: 'var(--mm-text)', fontSize: 13 }}>Cancel</button>
              <button onClick={() => void createRule()} style={{ background: '#4361EE', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: formName && formPattern ? 1 : 0.5 }}>Create Rule</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
