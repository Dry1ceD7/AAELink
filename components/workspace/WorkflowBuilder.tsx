'use client'

import { useState, useCallback, useEffect } from 'react'
import { apiFetch } from '@/lib/api/apiClient'
import { Zap, MessageSquare, Smile, Clock, Globe, UserPlus, FileText, Hash, Bell, Timer, GitBranch, Ticket, X, Plus, Trash2, GripVertical, ArrowLeft, Save, ToggleLeft, ToggleRight, Loader2 } from 'lucide-react'

/* ─────────────────────────────────────────────────────────────────────
   WorkflowBuilder — Slack Workflow Builder equivalent
   Wired to /api/approvals/workflows
   ───────────────────────────────────────────────────────────────────── */

interface WorkflowStep {
  id: string
  type: 'send_message' | 'collect_form' | 'set_topic' | 'add_reaction' | 'delay' | 'condition' | 'notify' | 'create_ticket' | 'update_channel'
  label: string
  config: Record<string, string>
}

interface Workflow {
  id: string
  name: string
  trigger: string
  triggerConfig: Record<string, string>
  steps: WorkflowStep[]
  enabled: boolean
  lastRun?: string
  runCount: number
}

const TRIGGERS = [
  { id: 'new_message', Icon: MessageSquare, label: 'New message in channel', desc: 'Runs when a message is posted' },
  { id: 'emoji_reaction', Icon: Smile, label: 'Emoji reaction added', desc: 'Runs when a reaction is added' },
  { id: 'scheduled', Icon: Clock, label: 'On a schedule', desc: 'Runs at a recurring time' },
  { id: 'webhook', Icon: Globe, label: 'Webhook received', desc: 'Runs when an external webhook fires' },
  { id: 'member_join', Icon: UserPlus, label: 'Member joins channel', desc: 'Runs when someone joins' },
  { id: 'form_submit', Icon: FileText, label: 'Form submitted', desc: 'Runs when a form response comes in' },
]

const STEP_TYPES = [
  { type: 'send_message' as const, Icon: MessageSquare, label: 'Send a message', color: '#4361EE' },
  { type: 'collect_form' as const, Icon: FileText, label: 'Collect info in a form', color: '#2bac76' },
  { type: 'set_topic' as const, Icon: Hash, label: 'Set channel topic', color: '#e8912d' },
  { type: 'add_reaction' as const, Icon: Smile, label: 'Add a reaction', color: '#e01e5a' },
  { type: 'delay' as const, Icon: Timer, label: 'Wait / Delay', color: '#8b5cf6' },
  { type: 'condition' as const, Icon: GitBranch, label: 'Add a condition', color: '#06b6d4' },
  { type: 'notify' as const, Icon: Bell, label: 'Send notification', color: '#f59e0b' },
  { type: 'create_ticket' as const, Icon: Ticket, label: 'Create a ticket', color: '#ec4899' },
]

let stepId = 0
const makeStepId = () => `step-${++stepId}-${Date.now()}`

export default function WorkflowBuilder({ onClose }: { onClose: () => void }) {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'list' | 'edit'>('list')
  const [editingWf, setEditingWf] = useState<Workflow | null>(null)
  const [showTriggerPicker, setShowTriggerPicker] = useState(false)
  const [showStepPicker, setShowStepPicker] = useState(false)
  const [dragIdx, setDragIdx] = useState<number | null>(null)

  const loadWorkflows = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/approvals/workflows')
      if (res.ok) {
        const data = await res.json()
        setWorkflows(data.workflows || [])
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { loadWorkflows() }, [loadWorkflows])

  const createNew = useCallback(() => {
    const wf: Workflow = {
      id: `wf-${Date.now()}`, name: 'Untitled Workflow', trigger: '',
      triggerConfig: {}, steps: [], enabled: false, runCount: 0,
    }
    setEditingWf(wf)
    setView('edit')
    setShowTriggerPicker(true)
  }, [])

  const openEdit = useCallback((wf: Workflow) => {
    setEditingWf({ ...wf, steps: (wf.steps || []).map(s => ({ ...s })) })
    setView('edit')
  }, [])

  const saveWf = useCallback(async () => {
    if (!editingWf) return
    try {
      await apiFetch('/api/approvals/workflows', {
        method: 'POST',
        body: JSON.stringify(editingWf),
      })
    } catch { /* ignore */ }
    setWorkflows(prev => {
      const idx = prev.findIndex(w => w.id === editingWf.id)
      if (idx >= 0) { const n = [...prev]; n[idx] = editingWf; return n }
      return [...prev, editingWf]
    })
    setView('list')
    setEditingWf(null)
  }, [editingWf])

  const addStep = useCallback((type: WorkflowStep['type']) => {
    if (!editingWf) return
    const tpl = STEP_TYPES.find(s => s.type === type)
    setEditingWf({
      ...editingWf,
      steps: [...editingWf.steps, { id: makeStepId(), type, label: tpl?.label || type, config: {} }],
    })
    setShowStepPicker(false)
  }, [editingWf])

  const removeStep = useCallback((stepIdToRemove: string) => {
    if (!editingWf) return
    setEditingWf({ ...editingWf, steps: editingWf.steps.filter(s => s.id !== stepIdToRemove) })
  }, [editingWf])

  const moveStep = useCallback((from: number, to: number) => {
    if (!editingWf) return
    const steps = [...editingWf.steps]
    const [moved] = steps.splice(from, 1)
    steps.splice(to, 0, moved)
    setEditingWf({ ...editingWf, steps })
  }, [editingWf])

  const toggleEnabled = useCallback(async (id: string) => {
    setWorkflows(prev => prev.map(w => w.id === id ? { ...w, enabled: !w.enabled } : w))
    await apiFetch('/api/approvals/workflows', {
      method: 'PATCH', body: JSON.stringify({ id, toggle: true }),
    }).catch(() => {})
  }, [])

  const deleteWf = useCallback(async (id: string) => {
    setWorkflows(prev => prev.filter(w => w.id !== id))
    await apiFetch(`/api/approvals/workflows?id=${id}`, { method: 'DELETE' }).catch(() => {})
  }, [])

  const card: React.CSSProperties = {
    background: 'var(--mm-main-bg)', border: '1px solid var(--mm-border)',
    borderRadius: 12, padding: 16, cursor: 'pointer',
  }

  /* ── LIST VIEW ──────────────────────────────────── */
  if (view === 'list') {
    return (
      <div className="workflow-shell">
        <div className="workflow-toolbar">
          <div className="workflow-toolbar-left">
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #4361EE, #4CC9F0)', display: 'grid', placeItems: 'center' }}>
              <Zap size={18} color="#fff" />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Workflow Builder</h2>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>Automate routine tasks without code</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={createNew} style={{
              background: 'linear-gradient(135deg, #4361EE, #2B35AF)', color: '#fff',
              border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13,
              fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
            }}><Plus size={14} /> New Workflow</button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)' }}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60, opacity: 0.5 }}>
              <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: 13, marginTop: 8 }}>Loading workflows…</span>
            </div>
          ) : workflows.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, opacity: 0.5 }}>
              <Zap size={48} style={{ marginBottom: 16 }} />
              <p style={{ fontSize: 15 }}>No workflows yet. Create one to automate tasks!</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {workflows.map(wf => {
                const trigger = TRIGGERS.find(t => t.id === wf.trigger)
                return (
                  <div key={wf.id} className="aae-hoverable" style={card}
                    onClick={() => openEdit(wf)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                          width: 40, height: 40, borderRadius: 10,
                          background: wf.enabled ? 'linear-gradient(135deg, #4361EE, #4CC9F0)' : 'var(--mm-hover-bg)',
                          display: 'grid', placeItems: 'center',
                        }}>
                          <Zap size={18} color={wf.enabled ? '#fff' : 'var(--mm-muted)'} />
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 15 }}>{wf.name}</div>
                          <div style={{ fontSize: 12, opacity: 0.6, display: 'flex', gap: 8, marginTop: 2, alignItems: 'center' }}>
                            {trigger && <trigger.Icon size={12} />}
                            <span>{trigger?.label || 'No trigger'}</span>
                            <span>· {(wf.steps || []).length} step{(wf.steps || []).length !== 1 ? 's' : ''}</span>
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }} onClick={e => e.stopPropagation()}>
                        <div style={{ textAlign: 'right', fontSize: 11, opacity: 0.5 }}>
                          {wf.lastRun && <div>Last run: {wf.lastRun}</div>}
                          <div>{wf.runCount} runs</div>
                        </div>
                        <button onClick={() => toggleEnabled(wf.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: wf.enabled ? '#2bac76' : 'var(--mm-muted)' }}>
                          {wf.enabled ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
                        </button>
                        <button onClick={() => deleteWf(wf.id)} title="Delete" style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--mm-muted)', padding: 4, display: 'grid', placeItems: 'center',
                        }}>
                          <Trash2 size={16} />
                        </button>
                      </div>
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

  /* ── EDIT VIEW ──────────────────────────────────── */
  if (!editingWf) return null
  const selectedTrigger = TRIGGERS.find(t => t.id === editingWf.trigger)

  return (
    <div className="workflow-shell">
      <div className="workflow-toolbar workflow-toolbar--edit">
        <div className="workflow-toolbar-left">
          <button onClick={() => { setView('list'); setEditingWf(null) }} style={{
            background: 'var(--mm-hover-bg)', border: 'none', borderRadius: 8,
            padding: '6px 10px', cursor: 'pointer', color: 'var(--mm-text)', fontSize: 13,
            display: 'flex', alignItems: 'center', gap: 4,
          }}><ArrowLeft size={14} /> Back</button>
          <input
            value={editingWf.name}
            onChange={e => setEditingWf({ ...editingWf, name: e.target.value })}
            style={{ background: 'none', border: 'none', fontSize: 17, fontWeight: 700, color: 'var(--mm-text)', outline: 'none', width: 300 }}
            placeholder="Workflow name"
          />
        </div>
        <button onClick={saveWf} style={{
          background: '#2bac76', color: '#fff', border: 'none', borderRadius: 8,
          padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 4,
        }}><Save size={14} /> Save Workflow</button>
      </div>

      <div className="workflow-canvas">
        {/* Trigger */}
        <div className="workflow-canvas-row">
          <div className="workflow-section-label">
            Trigger
          </div>
          {selectedTrigger ? (
            <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, borderColor: '#4361EE', borderWidth: 2 }}
              onClick={() => setShowTriggerPicker(true)}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg, #4361EE, #4CC9F0)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <selectedTrigger.Icon size={18} color="#fff" />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{selectedTrigger.label}</div>
                <div style={{ fontSize: 12, opacity: 0.6 }}>{selectedTrigger.desc}</div>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowTriggerPicker(true)} style={{
              ...card, width: '100%', display: 'flex', alignItems: 'center', gap: 10,
              border: '2px dashed var(--mm-border)', color: 'var(--mm-muted)', fontSize: 14,
            }}>
              <Plus size={18} /> Choose a trigger
            </button>
          )}
        </div>

        {editingWf.steps.length > 0 && <div className="workflow-rail" />}

        {editingWf.steps.map((step, idx) => {
          const tpl = STEP_TYPES.find(s => s.type === step.type)
          return (
            <div key={step.id} style={{ width: '100%', maxWidth: 480 }}>
              <div draggable onDragStart={() => setDragIdx(idx)} onDragOver={e => e.preventDefault()}
                onDrop={() => { if (dragIdx !== null && dragIdx !== idx) moveStep(dragIdx, idx); setDragIdx(null) }}
                style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, borderLeft: `3px solid ${tpl?.color || '#4361EE'}`, opacity: dragIdx === idx ? 0.4 : 1 }}
              >
                <div style={{ cursor: 'grab', color: 'var(--mm-muted)', padding: '0 2px', display: 'grid', placeItems: 'center' }}>
                  <GripVertical size={16} />
                </div>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: `${tpl?.color || '#4361EE'}18`, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                  {tpl && <tpl.Icon size={16} style={{ color: tpl.color }} />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{step.label}</div>
                  <div style={{ fontSize: 11, opacity: 0.5 }}>Step {idx + 1} · {tpl?.label}</div>
                </div>
                <button onClick={() => removeStep(step.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-muted)', padding: 4 }}>
                  <X size={14} />
                </button>
              </div>
              {idx < editingWf.steps.length - 1 && (
                <div className="workflow-rail-center">
                  <div className="workflow-rail workflow-rail--short" />
                </div>
              )}
            </div>
          )
        })}

        <div className="workflow-rail-center workflow-rail-center--top">
          {editingWf.steps.length > 0 && <div className="workflow-rail workflow-rail--short" />}
        </div>
        <button onClick={() => setShowStepPicker(true)} style={{
          ...card, width: '100%', maxWidth: 480,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          border: '2px dashed var(--mm-border)', color: '#4361EE', fontSize: 14, fontWeight: 600,
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#4361EE'; e.currentTarget.style.background = 'rgba(67,97,238,0.04)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--mm-border)'; e.currentTarget.style.background = 'var(--mm-main-bg)' }}
        >
          <Plus size={16} /> Add a step
        </button>
      </div>

      {/* Trigger picker */}
      {showTriggerPicker && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 3000, display: 'grid', placeItems: 'center', animation: 'slack-modal-in 200ms var(--slack-ease-bounce) forwards' }}
          onClick={() => setShowTriggerPicker(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--mm-main-bg)', borderRadius: 16, padding: 24, width: 440, maxHeight: '70vh', overflowY: 'auto', boxShadow: 'var(--slack-shadow-modal)' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 800 }}>Choose a trigger</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {TRIGGERS.map(t => (
                <button key={t.id} onClick={() => { setEditingWf({ ...editingWf, trigger: t.id }); setShowTriggerPicker(false) }}
                  style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', border: editingWf.trigger === t.id ? '2px solid #4361EE' : '1px solid var(--mm-border)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--mm-hover-bg)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'var(--mm-main-bg)')}
                >
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(67,97,238,0.1)', display: 'grid', placeItems: 'center' }}>
                    <t.Icon size={18} style={{ color: '#4361EE' }} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{t.label}</div>
                    <div style={{ fontSize: 12, opacity: 0.6 }}>{t.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Step picker */}
      {showStepPicker && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 3000, display: 'grid', placeItems: 'center', animation: 'slack-modal-in 200ms var(--slack-ease-bounce) forwards' }}
          onClick={() => setShowStepPicker(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--mm-main-bg)', borderRadius: 16, padding: 24, width: 440, maxHeight: '70vh', overflowY: 'auto', boxShadow: 'var(--slack-shadow-modal)' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 800 }}>Add a step</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {STEP_TYPES.map(s => (
                <button key={s.type} onClick={() => addStep(s.type)} style={{
                  ...card, display: 'flex', flexDirection: 'column', alignItems: 'center',
                  gap: 8, textAlign: 'center', padding: 16, borderLeft: `3px solid ${s.color}`,
                }}
                  onMouseEnter={e => { e.currentTarget.style.background = `${s.color}08`; e.currentTarget.style.borderColor = s.color }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--mm-main-bg)'; e.currentTarget.style.borderColor = 'var(--mm-border)' }}
                >
                  <s.Icon size={24} style={{ color: s.color }} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
