'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api/apiClient'
import { AlertCircle, Zap, Play, Clock, CheckCircle2, XCircle, Plus, Trash2 } from 'lucide-react'
import { DataTable } from '@/components/primitives'

type FunctionDef = {
  id: string
  name: string
  description: string
  input_schema: Record<string, unknown>
  output_schema: Record<string, unknown>
  app_id: string
  is_active: boolean
  created_at: number
}

type FunctionExecution = {
  id: string
  function_id: string
  status: string
  inputs: Record<string, unknown>
  outputs: Record<string, unknown>
  error: string
  triggered_by: string
  created_at: number
  completed_at: number
}

export function FunctionsPanel() {
  const [functions, setFunctions] = useState<FunctionDef[]>([])
  const [executions, setExecutions] = useState<FunctionExecution[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [msgType, setMsgType] = useState<'info' | 'error'>('info')

  // Create form
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newInputSchema, setNewInputSchema] = useState('{}')
  const [newOutputSchema, setNewOutputSchema] = useState('{}')
  const [createBusy, setCreateBusy] = useState(false)

  // Execute form
  const [execFnId, setExecFnId] = useState('')
  const [execInputs, setExecInputs] = useState('{}')
  const [execBusy, setExecBusy] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const res = await apiFetch('/api/functions')
      if (res.ok) {
        const d = await res.json()
        setFunctions(d.functions || [])
        setExecutions(d.executions || [])
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadData() }, [loadData])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return
    setCreateBusy(true)
    setMsg('')

    try {
      let inputSchema: Record<string, unknown> = {}
      let outputSchema: Record<string, unknown> = {}
      try { inputSchema = JSON.parse(newInputSchema) } catch { /* ignore */ }
      try { outputSchema = JSON.parse(newOutputSchema) } catch { /* ignore */ }

      const res = await apiFetch('/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'register',
          name: newName.trim(),
          description: newDesc.trim(),
          input_schema: inputSchema,
          output_schema: outputSchema,
        })
      })

      if (res.ok) {
        setMsg('Function registered successfully')
        setMsgType('info')
        setNewName('')
        setNewDesc('')
        setNewInputSchema('{}')
        setNewOutputSchema('{}')
        void loadData()
      } else {
        const d = await res.json()
        setMsg(d.error || 'Failed to register function')
        setMsgType('error')
      }
    } catch {
      setMsg('Network error')
      setMsgType('error')
    } finally {
      setCreateBusy(false)
    }
  }

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!execFnId) return
    setExecBusy(true)
    setMsg('')

    try {
      let inputs: Record<string, unknown> = {}
      try { inputs = JSON.parse(execInputs) } catch { /* ignore */ }

      const res = await apiFetch('/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'execute',
          function_id: execFnId,
          inputs,
        })
      })

      if (res.ok) {
        setMsg('Function executed successfully')
        setMsgType('info')
        void loadData()
      } else {
        const d = await res.json()
        setMsg(d.error || 'Execution failed')
        setMsgType('error')
      }
    } catch {
      setMsg('Network error')
      setMsgType('error')
    } finally {
      setExecBusy(false)
    }
  }

  const handleToggle = async (fnId: string, active: boolean) => {
    const res = await apiFetch('/api/functions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: active ? 'activate' : 'deactivate',
        function_id: fnId,
      })
    })
    if (res.ok) void loadData()
  }

  const statusBadge = (status: string) => {
    const colors: Record<string, { bg: string; fg: string }> = {
      completed: { bg: 'rgba(46,160,67,0.15)', fg: '#2ea043' },
      failed: { bg: 'rgba(200,0,0,0.1)', fg: '#c00' },
      running: { bg: 'rgba(0,100,200,0.1)', fg: '#0064c8' },
      pending: { bg: 'rgba(200,150,0,0.1)', fg: '#c89600' },
    }
    const c = colors[status] || colors.pending
    return (
      <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 6, background: c.bg, color: c.fg }}>
        {status}
      </span>
    )
  }

  if (loading) return <div style={{ fontSize: 13, color: 'var(--doc-muted)' }}>Loading functions...</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Zap size={18} style={{ color: 'var(--aae-accent, var(--aae-link))' }} />
        <h2 className="mm-auth-section-title" style={{ margin: 0 }}>Custom Functions</h2>
      </div>
      <p className="aae-auth-lead">
        Register reusable automation functions with typed input/output schemas. Execute them manually or wire into workflows.
      </p>

      {/* Registry */}
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Function Registry ({functions.length})</h3>
        {functions.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--doc-muted)' }}>No functions registered yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {functions.map(fn => (
              <div key={fn.id} style={{
                border: '1px solid var(--mm-border-subtle)', padding: 14, borderRadius: 8,
                background: 'var(--mm-channel-bg)',
                opacity: fn.is_active ? 1 : 0.6,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{fn.name}</span>
                    {fn.description && <span style={{ fontSize: 12, color: 'var(--doc-muted)', marginLeft: 8 }}>— {fn.description}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {statusBadge(fn.is_active ? 'active' : 'inactive')}
                    <button type="button" className="ghost-button" style={{ fontSize: 11, padding: '2px 6px' }}
                      onClick={() => void handleToggle(fn.id, !fn.is_active)}>
                      {fn.is_active ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                </div>
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--doc-muted)', display: 'flex', gap: 16 }}>
                  <span>Input: {Object.keys(fn.input_schema).length} fields</span>
                  <span>Output: {Object.keys(fn.output_schema).length} fields</span>
                  <span>Created: {new Date(fn.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Execute */}
      {functions.length > 0 && (
        <div style={{ borderTop: '1px solid var(--mm-border-subtle)', paddingTop: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
            <Play size={14} />
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Execute Function</h3>
          </div>
          <form onSubmit={handleExecute} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 500 }}>
            <label className="field-label" htmlFor="exec-fn">
              Function
              <select id="exec-fn" className="slack-input" value={execFnId}
                onChange={e => setExecFnId(e.target.value)}>
                <option value="">Select a function…</option>
                {functions.filter(f => f.is_active).map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </label>
            <label className="field-label" htmlFor="exec-inputs">
              Inputs (JSON)
              <textarea id="exec-inputs" className="slack-input" value={execInputs}
                onChange={e => setExecInputs(e.target.value)}
                rows={3} style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }} />
            </label>
            <button type="submit" className="slack-button" disabled={execBusy || !execFnId} style={{ justifySelf: 'start' }}>
              {execBusy ? 'Running...' : 'Execute'}
            </button>
          </form>
        </div>
      )}

      {/* Recent Executions */}
      {executions.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
            <Clock size={14} />
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Recent Executions</h3>
          </div>
          <DataTable>
            <thead>
              <tr>
                <th>Function</th>
                <th>Status</th>
                <th>Triggered By</th>
                <th>Duration</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {executions.slice(0, 20).map(ex => (
                <tr key={ex.id}>
                  <td>{functions.find(f => f.id === ex.function_id)?.name || ex.function_id.slice(0, 8)}</td>
                  <td>{statusBadge(ex.status)}</td>
                  <td style={{ fontSize: 11 }}>{ex.triggered_by || '—'}</td>
                  <td style={{ fontSize: 11 }}>
                    {ex.completed_at && ex.created_at ? `${Math.round((ex.completed_at - ex.created_at) / 1000)}s` : '—'}
                  </td>
                  <td style={{ fontSize: 11 }}>{ex.created_at ? new Date(ex.created_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      )}

      {/* Register New */}
      <div style={{ borderTop: '1px solid var(--mm-border-subtle)', paddingTop: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <Plus size={14} />
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Register New Function</h3>
        </div>
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 500 }}>
          <label className="field-label" htmlFor="fn-name">
            Name
            <input id="fn-name" className="slack-input" value={newName}
              onChange={e => setNewName(e.target.value)} placeholder="e.g. send_notification" required />
          </label>
          <label className="field-label" htmlFor="fn-desc">
            Description
            <input id="fn-desc" className="slack-input" value={newDesc}
              onChange={e => setNewDesc(e.target.value)} placeholder="What this function does" />
          </label>
          <label className="field-label" htmlFor="fn-input">
            Input Schema (JSON)
            <textarea id="fn-input" className="slack-input" value={newInputSchema}
              onChange={e => setNewInputSchema(e.target.value)}
              rows={3} style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }} />
          </label>
          <label className="field-label" htmlFor="fn-output">
            Output Schema (JSON)
            <textarea id="fn-output" className="slack-input" value={newOutputSchema}
              onChange={e => setNewOutputSchema(e.target.value)}
              rows={3} style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }} />
          </label>
          <button type="submit" className="slack-button" disabled={createBusy || !newName.trim()} style={{ justifySelf: 'start' }}>
            {createBusy ? 'Registering...' : 'Register Function'}
          </button>
        </form>
      </div>

      {msg && (
        <div className={`mm-auth-alert mm-auth-alert--${msgType}`} role="alert">
          {msgType === 'error' && <AlertCircle size={18} strokeWidth={2} />}
          <span>{msg}</span>
        </div>
      )}
    </div>
  )
}
