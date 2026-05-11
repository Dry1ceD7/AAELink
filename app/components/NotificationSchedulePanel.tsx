'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/apiClient'
import { Bell, Clock, Key, Hash, User, X, Plus, ToggleLeft, ToggleRight, Trash2, Volume2, Moon, Loader2 } from 'lucide-react'

/* ── Notification Schedule — Wired to /api/auth/notification-prefs ── */

interface NotifRule {
  id: string
  name: string
  enabled: boolean
  type: 'schedule' | 'keyword' | 'channel' | 'sender'
  config: Record<string, string>
  description: string
}

const typeConfig: Record<string, { Icon: typeof Bell; color: string; label: string }> = {
  schedule: { Icon: Clock, color: '#4361EE', label: 'Schedule' },
  keyword: { Icon: Key, color: '#e01e5a', label: 'Keyword' },
  channel: { Icon: Hash, color: '#2bac76', label: 'Channel' },
  sender: { Icon: User, color: '#f59e0b', label: 'Sender' },
}

export default function NotificationSchedulePanel({ onClose }: { onClose: () => void }) {
  const [rules, setRules] = useState<NotifRule[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [dndEnabled, setDndEnabled] = useState(false)
  const [dndFrom, setDndFrom] = useState('22:00')
  const [dndTo, setDndTo] = useState('08:00')
  const [notifSound, setNotifSound] = useState('default')

  // Create form state
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<'schedule' | 'keyword' | 'channel' | 'sender'>('schedule')
  const [newDescription, setNewDescription] = useState('')

  const loadPrefs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/auth/notification-prefs')
      if (res.ok) {
        const data = await res.json()
        setRules(data.rules || [])
        if (data.dnd_enabled !== undefined) setDndEnabled(data.dnd_enabled)
        if (data.dnd_from) setDndFrom(data.dnd_from)
        if (data.dnd_to) setDndTo(data.dnd_to)
        if (data.sound) setNotifSound(data.sound)
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { loadPrefs() }, [loadPrefs])

  const savePrefs = useCallback(async () => {
    await apiFetch('/api/auth/notification-prefs', {
      method: 'PUT',
      body: JSON.stringify({ rules, dnd_enabled: dndEnabled, dnd_from: dndFrom, dnd_to: dndTo, sound: notifSound }),
    }).catch(() => {})
  }, [rules, dndEnabled, dndFrom, dndTo, notifSound])

  const toggleRule = (id: string) => {
    setRules(prev => prev.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r))
    setTimeout(savePrefs, 100)
  }
  const deleteRule = (id: string) => {
    setRules(prev => prev.filter(r => r.id !== id))
    setTimeout(savePrefs, 100)
  }

  const createRule = () => {
    if (!newName.trim()) return
    const rule: NotifRule = {
      id: `rule-${Date.now()}`, name: newName, enabled: true,
      type: newType, config: {}, description: newDescription,
    }
    setRules(prev => [...prev, rule])
    setShowCreate(false)
    setNewName('')
    setNewDescription('')
    setTimeout(savePrefs, 100)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--mm-main-bg)', color: 'var(--mm-text)' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--mm-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #e01e5a, #c4133a)', display: 'grid', placeItems: 'center' }}>
              <Bell size={18} color="#fff" />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Notification Schedule</h2>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>Customize when and how you get notified</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowCreate(true)} style={{
              background: 'linear-gradient(135deg, #4361EE, #3730a3)', color: '#fff', border: 'none',
              borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 4,
            }}><Plus size={14} /> New Rule</button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Quick DND toggle */}
        <div style={{ padding: 14, borderRadius: 12, border: '1px solid var(--mm-border)', marginBottom: 12, background: dndEnabled ? '#e01e5a08' : 'transparent' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: dndEnabled ? 10 : 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Moon size={18} style={{ color: '#e01e5a' }} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Do Not Disturb</div>
                <div style={{ fontSize: 12, opacity: 0.5 }}>Pause all notifications</div>
              </div>
            </div>
            <button onClick={() => { setDndEnabled(!dndEnabled); setTimeout(savePrefs, 100) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: dndEnabled ? '#e01e5a' : 'var(--mm-muted)' }}>
              {dndEnabled ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
            </button>
          </div>
          {dndEnabled && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="time" value={dndFrom} onChange={e => { setDndFrom(e.target.value); setTimeout(savePrefs, 100) }}
                style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13 }} />
              <span style={{ fontSize: 12, opacity: 0.5 }}>to</span>
              <input type="time" value={dndTo} onChange={e => { setDndTo(e.target.value); setTimeout(savePrefs, 100) }}
                style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13 }} />
            </div>
          )}
        </div>

        {/* Sound setting */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
          <Volume2 size={14} style={{ opacity: 0.6 }} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>Notification Sound</span>
          <select value={notifSound} onChange={e => { setNotifSound(e.target.value); setTimeout(savePrefs, 100) }}
            style={{ marginLeft: 'auto', padding: '6px 10px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 12 }}>
            <option value="default">Default</option>
            <option value="chime">Chime</option>
            <option value="ding">Ding</option>
            <option value="pop">Pop</option>
            <option value="none">None</option>
          </select>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60, opacity: 0.5 }}>
            <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 13, marginTop: 8 }}>Loading preferences…</span>
          </div>
        ) : (
          <>
            <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, opacity: 0.7 }}>Notification Rules ({rules.filter(r => r.enabled).length} active)</h3>
            {rules.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, opacity: 0.5 }}>
                <Bell size={36} style={{ marginBottom: 8 }} />
                <p>No notification rules yet</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {rules.map(rule => {
                  const tc = typeConfig[rule.type]
                  return (
                    <div key={rule.id} style={{ padding: 14, borderRadius: 12, border: '1px solid var(--mm-border)', opacity: rule.enabled ? 1 : 0.5, borderLeft: `3px solid ${tc.color}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <tc.Icon size={16} style={{ color: tc.color }} />
                          <span style={{ fontWeight: 700, fontSize: 14 }}>{rule.name}</span>
                          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: `${tc.color}20`, color: tc.color, fontWeight: 600 }}>{tc.label}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <button onClick={() => toggleRule(rule.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: rule.enabled ? '#2bac76' : 'var(--mm-muted)' }}>
                            {rule.enabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                          </button>
                          <button onClick={() => deleteRule(rule.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e01e5a', display: 'grid', placeItems: 'center' }}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      <p style={{ margin: '0 0 6px', fontSize: 13, opacity: 0.7, paddingLeft: 24 }}>{rule.description}</p>
                      <div style={{ paddingLeft: 24, fontSize: 11, opacity: 0.5 }}>
                        {Object.entries(rule.config).map(([k, v]) => (
                          <span key={k} style={{ marginRight: 12 }}><strong>{k}:</strong> {v}</span>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>

      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 3000, display: 'grid', placeItems: 'center' }} onClick={() => setShowCreate(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--mm-main-bg)', borderRadius: 16, padding: 24, width: 420, boxShadow: 'var(--slack-shadow-modal)' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 800 }}>Create Notification Rule</h3>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>Rule Name</label>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g., Night Mode"
                style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>Type</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                {Object.entries(typeConfig).map(([key, val]) => (
                  <button key={key} onClick={() => setNewType(key as typeof newType)} style={{
                    padding: 8, borderRadius: 8, border: newType === key ? `2px solid ${val.color}` : '1px solid var(--mm-border)',
                    background: newType === key ? `${val.color}10` : 'transparent', cursor: 'pointer', textAlign: 'center', color: 'var(--mm-text)', fontSize: 11,
                  }}>
                    <val.Icon size={18} style={{ color: val.color, display: 'block', margin: '0 auto 4px' }} />
                    {val.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>Description</label>
              <input value={newDescription} onChange={e => setNewDescription(e.target.value)} placeholder="Describe what this rule does"
                style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--mm-border)', background: 'var(--mm-input-bg)', color: 'var(--mm-text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowCreate(false)} style={{ background: 'var(--mm-hover-bg)', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', color: 'var(--mm-text)', fontSize: 13 }}>Cancel</button>
              <button onClick={createRule} disabled={!newName.trim()} style={{
                background: '#4361EE', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px',
                fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: newName.trim() ? 1 : 0.5,
              }}>Create Rule</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
