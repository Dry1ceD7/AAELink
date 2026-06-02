'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api/apiClient'
import { AlertCircle, Plus, Trash2 } from 'lucide-react'

type UserRow = {
  id: string
  username: string
  email: string
  first_name: string
  last_name: string
  platform_role: string
}

type Workspace = {
  id: string
  name: string
}

type WorkflowStepConfig = {
  approver_user_id?: string
  approver_role?: string
}

export function WorkflowManagementPanel() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [selectedWorkspace, setSelectedWorkspace] = useState('')
  const [users, setUsers] = useState<UserRow[]>([])
  
  const [workflows, setWorkflows] = useState<{ id: string; name: string; description?: string; steps: { id: string; approver_user_id?: string; approver_role?: string }[] }[]>([])
  
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [msgType, setMsgType] = useState<'info'|'error'>('info')
  
  // Create state
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newSteps, setNewSteps] = useState<WorkflowStepConfig[]>([{ approver_role: 'it_admin' }])
  const [createBusy, setCreateBusy] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const [wsRes, uRes] = await Promise.all([
        apiFetch('/api/workspaces'),
        apiFetch('/api/admin/users')
      ])
      if (wsRes.ok) {
        const d = await wsRes.json()
        const wss = d.workspaces || []
        setWorkspaces(wss)
        if (wss.length > 0 && !selectedWorkspace) {
          setSelectedWorkspace(wss[0].id)
        }
      }
      if (uRes.ok) {
        const d = await uRes.json()
        setUsers(d.users || [])
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [selectedWorkspace])

  const loadWorkflows = useCallback(async (wsId: string) => {
    if (!wsId) return
    const res = await apiFetch(`/api/approvals/workflows?workspace_id=${wsId}`)
    if (res.ok) {
      const d = await res.json()
      setWorkflows(d.workflows || [])
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    if (selectedWorkspace) {
      void loadWorkflows(selectedWorkspace)
    }
  }, [selectedWorkspace, loadWorkflows])

  const handleAddStep = () => {
    setNewSteps(s => [...s, { approver_role: 'it_admin' }])
  }

  const handleRemoveStep = (idx: number) => {
    if (newSteps.length <= 1) return
    setNewSteps(s => s.filter((_, i) => i !== idx))
  }

  const handleStepChange = (idx: number, field: keyof WorkflowStepConfig, val: string) => {
    setNewSteps(s => {
      const copy = [...s]
      if (field === 'approver_role') {
        copy[idx] = { approver_role: val }
      } else if (field === 'approver_user_id') {
        copy[idx] = { approver_user_id: val }
      }
      return copy
    })
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg('')
    if (!selectedWorkspace || !newName.trim()) return
    setCreateBusy(true)

    try {
      const res = await apiFetch('/api/approvals/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: selectedWorkspace,
          name: newName.trim(),
          description: newDesc.trim(),
          steps: newSteps
        })
      })
      if (res.ok) {
        setMsg('Workflow created successfully')
        setMsgType('info')
        setNewName('')
        setNewDesc('')
        setNewSteps([{ approver_role: 'it_admin' }])
        void loadWorkflows(selectedWorkspace)
      } else {
        const d = await res.json()
        setMsg(d.error || 'Failed to create workflow')
        setMsgType('error')
      }
    } catch (e) {
      setMsg('Network error')
      setMsgType('error')
    } finally {
      setCreateBusy(false)
    }
  }

  if (loading) return <div style={{ fontSize: 13, color: 'var(--doc-muted)' }}>Loading workflows...</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <p className="aae-auth-lead">
        Define custom multi-step approval workflows for your organization.
      </p>

      {workspaces.length > 1 && (
        <div>
          <label className="field-label" htmlFor="ws-select">Workspace</label>
          <select 
            id="ws-select"
            className="slack-input"
            value={selectedWorkspace}
            onChange={e => setSelectedWorkspace(e.target.value)}
            style={{ maxWidth: 300 }}
          >
            {workspaces.map(w => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* List Existing Workflows */}
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Active Workflows</h3>
        {workflows.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--doc-muted)' }}>No workflows defined for this workspace.</p>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {workflows.map(wf => (
              <div key={wf.id} style={{ border: '1px solid var(--mm-border-subtle)', padding: 12, borderRadius: 8, background: 'var(--mm-channel-bg)' }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{wf.name}</div>
                {wf.description && <div style={{ fontSize: 13, color: 'var(--doc-muted)', marginTop: 4 }}>{wf.description}</div>}
                
                <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--doc-muted)' }}>STEPS:</span>
                  {wf.steps && wf.steps.map((step: { id: string; approver_user_id?: string; approver_role?: string }, idx: number) => (
                    <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ background: 'var(--mm-button-bg)', color: 'var(--mm-button-color)', padding: '2px 8px', borderRadius: 8, fontSize: 12 }}>
                        {idx + 1}. {step.approver_user_id ? `User: ${users.find(u => u.id === step.approver_user_id)?.username || step.approver_user_id}` : `Role: ${step.approver_role}`}
                      </div>
                      {idx < wf.steps.length - 1 && <span style={{ color: 'var(--doc-muted)' }}>→</span>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create New Workflow */}
      <div style={{ borderTop: '1px solid var(--mm-border-subtle)', paddingTop: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Create New Workflow</h3>
        
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 600 }}>
          <label className="field-label" htmlFor="wf-name">
            Workflow Name
            <input 
              id="wf-name"
              className="slack-input"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="e.g. Server Access Request"
              required
            />
          </label>
          
          <label className="field-label" htmlFor="wf-desc">
            Description
            <input 
              id="wf-desc"
              className="slack-input"
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder="Optional description"
            />
          </label>

          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--fg)' }}>Approval Steps</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {newSteps.map((step, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--doc-muted)', width: 24 }}>{idx + 1}.</div>
                  <select 
                    className="slack-input" 
                    value={step.approver_role ? 'role' : 'user'}
                    onChange={e => {
                      if (e.target.value === 'role') {
                        handleStepChange(idx, 'approver_role', 'it_admin')
                      } else {
                        handleStepChange(idx, 'approver_user_id', users[0]?.id || '')
                      }
                    }}
                    style={{ width: 120 }}
                  >
                    <option value="role">By Role</option>
                    <option value="user">By User</option>
                  </select>
                  
                  {step.approver_role !== undefined ? (
                    <select 
                      className="slack-input"
                      value={step.approver_role}
                      onChange={e => handleStepChange(idx, 'approver_role', e.target.value)}
                      style={{ flex: 1 }}
                    >
                      <option value="super_admin">Super Admin</option>
                      <option value="it_admin">IT Admin</option>
                      <option value="it_support">IT Support</option>
                      <option value="it_employee">IT Employee</option>
                    </select>
                  ) : (
                    <select 
                      className="slack-input"
                      value={step.approver_user_id || ''}
                      onChange={e => handleStepChange(idx, 'approver_user_id', e.target.value)}
                      style={{ flex: 1 }}
                    >
                      {users.map(u => (
                        <option key={u.id} value={u.id}>{u.username} ({u.email})</option>
                      ))}
                    </select>
                  )}

                  <button 
                    type="button" 
                    className="ghost-button" 
                    style={{ padding: 6, color: newSteps.length === 1 ? 'var(--doc-muted)' : 'var(--mm-online)' }}
                    onClick={() => handleRemoveStep(idx)}
                    disabled={newSteps.length === 1}
                    title="Remove Step"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
            
            <button 
              type="button" 
              className="ghost-button" 
              style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}
              onClick={handleAddStep}
            >
              <Plus size={14} /> Add Step
            </button>
          </div>

          {msg && (
            <div className={`mm-auth-alert mm-auth-alert--${msgType}`} role="alert">
              {msgType === 'error' && <AlertCircle size={18} strokeWidth={2} />}
              <span>{msg}</span>
            </div>
          )}

          <button type="submit" className="slack-button" disabled={createBusy || !newName.trim()} style={{ justifySelf: 'start', marginTop: 8 }}>
            {createBusy ? 'Creating...' : 'Create Workflow'}
          </button>
        </form>
      </div>
    </div>
  )
}
