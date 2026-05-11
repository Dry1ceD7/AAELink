'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/apiClient'
import {
  Check, X, Clock, FileText, CheckCircle2, XCircle, Plus,
  ChevronDown, ChevronRight, Ban, MessageSquare, ArrowRight, Loader2
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type ApprovalRequest = {
  id: string
  workflow_id: string
  workflow_name: string
  title: string
  description: string
  status: 'pending' | 'approved' | 'rejected' | 'canceled'
  created_at: number
  updated_at: number
  requester_name?: string
  requester_id?: string
  current_step_order: number
}

type Workflow = {
  id: string
  name: string
  description: string
  steps: { id: string; step_order: number; approver_user_id?: string; approver_role?: string }[]
}

type ReviewEntry = {
  id: string
  step_order: number
  decision: string
  comment: string
  created_at: number
  reviewer_name: string
  reviewer_username: string
}

type StepEntry = {
  step_order: number
  approver_user_id: string | null
  approver_role: string
  approver_name?: string
  approver_username?: string
}

type ApprovalsData = {
  my_requests: ApprovalRequest[]
  pending_approvals: ApprovalRequest[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { bg: string; fg: string; icon: React.ReactNode; label: string }> = {
  pending:  { bg: 'rgba(245,171,0,0.1)',  fg: '#f5ab00', icon: <Clock size={14} />,        label: 'Pending' },
  approved: { bg: 'rgba(56,151,141,0.1)',  fg: 'var(--mm-online)', icon: <CheckCircle2 size={14} />, label: 'Approved' },
  rejected: { bg: 'rgba(210,75,78,0.1)',   fg: '#d24b4e', icon: <XCircle size={14} />,      label: 'Rejected' },
  canceled: { bg: 'rgba(128,128,128,0.1)', fg: 'var(--mm-muted)', icon: <Ban size={14} />,  label: 'Canceled' },
}

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CONFIG[status] || STATUS_CONFIG.pending
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px',
      borderRadius: 8, fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
      background: c.bg, color: c.fg, letterSpacing: '0.3px'
    }}>
      {c.icon} {c.label}
    </div>
  )
}

function fmtDate(ts: number) {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

// ── Main Component ────────────────────────────────────────────────────────────

export function ApprovalsPanel({ workspaceId }: { workspaceId: string }) {
  const [data, setData] = useState<ApprovalsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'pending' | 'mine'>('pending')

  // New Request form
  const [showCreate, setShowCreate] = useState(false)
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [selWorkflow, setSelWorkflow] = useState('')
  const [reqTitle, setReqTitle] = useState('')
  const [reqDesc, setReqDesc] = useState('')
  const [createBusy, setCreateBusy] = useState(false)
  const [createMsg, setCreateMsg] = useState('')

  // Review modal
  const [reviewTarget, setReviewTarget] = useState<ApprovalRequest | null>(null)
  const [reviewDecision, setReviewDecision] = useState<'approved' | 'rejected'>('approved')
  const [reviewComment, setReviewComment] = useState('')
  const [reviewBusy, setReviewBusy] = useState(false)

  // Detail panel
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailReviews, setDetailReviews] = useState<ReviewEntry[]>([])
  const [detailSteps, setDetailSteps] = useState<StepEntry[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  const loadData = useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    try {
      const res = await apiFetch(`/api/approvals/requests?workspace_id=${workspaceId}`)
      if (res.ok) setData(await res.json() as ApprovalsData)
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  const loadWorkflows = useCallback(async () => {
    if (!workspaceId) return
    const res = await apiFetch(`/api/approvals/workflows?workspace_id=${workspaceId}`)
    if (res.ok) {
      const d = await res.json() as { workflows: Workflow[] }
      setWorkflows(d.workflows || [])
      if (d.workflows?.length && !selWorkflow) setSelWorkflow(d.workflows[0].id)
    }
  }, [workspaceId, selWorkflow])

  useEffect(() => { void loadData() }, [loadData])

  // ── Actions ───────────────────────────────────────────────────────────

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selWorkflow || !reqTitle.trim() || !reqDesc.trim()) return
    setCreateBusy(true)
    setCreateMsg('')
    try {
      const res = await apiFetch('/api/approvals/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId, workflow_id: selWorkflow,
          title: reqTitle.trim(), description: reqDesc.trim()
        })
      })
      if (res.ok) {
        setCreateMsg('Request submitted successfully.')
        setReqTitle(''); setReqDesc('')
        setShowCreate(false)
        setActiveTab('mine')
        await loadData()
      } else {
        const d = await res.json().catch(() => ({})) as { error?: string }
        setCreateMsg(d.error || 'Failed to submit request')
      }
    } finally { setCreateBusy(false) }
  }

  const openReview = (req: ApprovalRequest, decision: 'approved' | 'rejected') => {
    setReviewTarget(req)
    setReviewDecision(decision)
    setReviewComment('')
    setReviewBusy(false)
  }

  const submitReview = async () => {
    if (!reviewTarget || reviewBusy) return
    setReviewBusy(true)
    try {
      const res = await apiFetch(`/api/approvals/requests/${reviewTarget.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: reviewDecision, comment: reviewComment.trim() })
      })
      if (res.ok) {
        setReviewTarget(null)
        await loadData()
      } else {
        alert('Failed to submit review.')
      }
    } finally { setReviewBusy(false) }
  }

  const cancelRequest = async (id: string) => {
    if (!confirm('Cancel this request? This cannot be undone.')) return
    setSubmitting(id)
    try {
      const res = await apiFetch(`/api/approvals/requests/${id}`, { method: 'DELETE' })
      if (res.ok) await loadData()
      else alert('Failed to cancel request.')
    } finally { setSubmitting(null) }
  }

  const loadDetail = async (id: string) => {
    if (detailId === id) { setDetailId(null); return }
    setDetailId(id)
    setDetailLoading(true)
    try {
      const res = await apiFetch(`/api/approvals/requests/${id}`)
      if (res.ok) {
        const d = await res.json() as { reviews: ReviewEntry[]; steps: StepEntry[] }
        setDetailReviews(d.reviews || [])
        setDetailSteps(d.steps || [])
      }
    } finally { setDetailLoading(false) }
  }

  // ── Render ────────────────────────────────────────────────────────────

  if (loading && !data) {
    return <div style={{ padding: 24, color: 'var(--mm-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
      <Loader2 size={16} className="spin" /> Loading approvals…
    </div>
  }

  const { pending_approvals = [], my_requests = [] } = data || {}

  return (
    <div style={{ padding: 24, height: '100%', overflowY: 'auto' }}>
      {/* ── Tab Bar + New Request Button ─────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        {(['pending', 'mine'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            background: activeTab === tab ? 'var(--mm-primary)' : 'transparent',
            color: activeTab === tab ? 'var(--mm-primary-text)' : 'var(--fg)',
            border: activeTab === tab ? 'none' : '1px solid var(--mm-border)',
            padding: '7px 14px', borderRadius: 8, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6, fontSize: 13,
            transition: 'all 0.15s ease'
          }}>
            {tab === 'pending' ? <><Clock size={15} /> Needs My Review ({pending_approvals.length})</> :
              <><FileText size={15} /> My Requests ({my_requests.length})</>}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={() => { setShowCreate(v => !v); if (!showCreate) void loadWorkflows() }} style={{
          background: 'var(--mm-online)', color: '#fff', border: 'none',
          padding: '7px 14px', borderRadius: 8, fontWeight: 600, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 6, fontSize: 13
        }}>
          <Plus size={15} /> New Request
        </button>
      </div>

      {/* ── New Request Form ─────────────────────────────────────── */}
      {showCreate && (
        <div style={{
          background: 'var(--mm-channel-bg)', border: '1px solid var(--mm-border)',
          borderRadius: 8, padding: 20, marginBottom: 20
        }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700 }}>Submit New Approval Request</h3>
          <form onSubmit={handleCreateRequest} style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>
              Workflow
              <select className="slack-input" value={selWorkflow}
                onChange={e => setSelWorkflow(e.target.value)}
                style={{ marginTop: 4, display: 'block', width: '100%' }}>
                {workflows.length === 0 && <option value="">No workflows available</option>}
                {workflows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 13, fontWeight: 600 }}>
              Title
              <input className="slack-input" value={reqTitle}
                onChange={e => setReqTitle(e.target.value)} required
                placeholder="e.g. VPN Access for Project Alpha"
                style={{ marginTop: 4, display: 'block', width: '100%' }} />
            </label>
            <label style={{ fontSize: 13, fontWeight: 600 }}>
              Description
              <textarea className="slack-input" value={reqDesc}
                onChange={e => setReqDesc(e.target.value)} required rows={4}
                placeholder="Explain what you need and why…"
                style={{ marginTop: 4, display: 'block', width: '100%', resize: 'vertical' }} />
            </label>
            {createMsg && <div style={{ fontSize: 13, color: createMsg.includes('success') ? 'var(--mm-online)' : '#d24b4e' }}>{createMsg}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="slack-button" disabled={createBusy || !selWorkflow || !reqTitle.trim()}>
                {createBusy ? 'Submitting…' : 'Submit Request'}
              </button>
              <button type="button" className="ghost-button" onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Pending Approvals Tab ────────────────────────────────── */}
      {activeTab === 'pending' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {pending_approvals.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--mm-muted)' }}>
              <CheckCircle2 size={40} strokeWidth={1.5} style={{ opacity: 0.3, marginBottom: 12 }} />
              <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>All caught up!</p>
              <p style={{ fontSize: 13 }}>No approvals are waiting for your review.</p>
            </div>
          ) : (
            pending_approvals.map(req => (
              <RequestCard key={req.id} req={req} mode="review"
                onApprove={() => openReview(req, 'approved')}
                onReject={() => openReview(req, 'rejected')}
                busy={submitting === req.id}
                expanded={detailId === req.id}
                onToggleDetail={() => void loadDetail(req.id)}
                detailLoading={detailLoading && detailId === req.id}
                reviews={detailId === req.id ? detailReviews : []}
                steps={detailId === req.id ? detailSteps : []} />
            ))
          )}
        </div>
      )}

      {/* ── My Requests Tab ──────────────────────────────────────── */}
      {activeTab === 'mine' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {my_requests.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--mm-muted)' }}>
              <FileText size={40} strokeWidth={1.5} style={{ opacity: 0.3, marginBottom: 12 }} />
              <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>No requests yet</p>
              <p style={{ fontSize: 13 }}>Click &quot;New Request&quot; to submit your first approval.</p>
            </div>
          ) : (
            my_requests.map(req => (
              <RequestCard key={req.id} req={req} mode="mine"
                onCancel={() => void cancelRequest(req.id)}
                busy={submitting === req.id}
                expanded={detailId === req.id}
                onToggleDetail={() => void loadDetail(req.id)}
                detailLoading={detailLoading && detailId === req.id}
                reviews={detailId === req.id ? detailReviews : []}
                steps={detailId === req.id ? detailSteps : []} />
            ))
          )}
        </div>
      )}

      {/* ── Review Modal ─────────────────────────────────────────── */}
      {reviewTarget && (
        <div className="mm-modal-overlay" role="presentation"
          onClick={e => { if (e.target === e.currentTarget && !reviewBusy) setReviewTarget(null) }}>
          <div className="mm-modal" role="dialog" aria-modal="true"
            onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h2 style={{ margin: '0 0 8px', fontSize: 17 }}>
              {reviewDecision === 'approved' ? <><CheckCircle2 size={16} style={{color:'var(--mm-online)'}}/> Approve</> : <><XCircle size={16} style={{color:'#d24b4e'}}/> Reject</>} Request
            </h2>
            <p style={{ fontSize: 14, color: 'var(--mm-muted)', margin: '0 0 16px' }}>
              <strong>{reviewTarget.title}</strong> — {reviewTarget.workflow_name}
            </p>
            <label style={{ fontSize: 13, fontWeight: 600 }}>
              Comment {reviewDecision === 'rejected' ? '(recommended)' : '(optional)'}
              <textarea className="slack-input" value={reviewComment}
                onChange={e => setReviewComment(e.target.value)} rows={3}
                placeholder={reviewDecision === 'rejected' ? 'Provide a reason for rejection…' : 'Add a note…'}
                style={{ marginTop: 4, display: 'block', width: '100%', resize: 'vertical' }} />
            </label>
            <div className="mm-modal-actions" style={{ marginTop: 16 }}>
              <button className="ghost-button" onClick={() => setReviewTarget(null)} disabled={reviewBusy}>Cancel</button>
              <button className="slack-button" disabled={reviewBusy}
                onClick={() => void submitReview()}
                style={{
                  background: reviewDecision === 'approved' ? 'var(--mm-online)' : '#d24b4e',
                  color: '#fff'
                }}>
                {reviewBusy ? 'Submitting…' : reviewDecision === 'approved' ? 'Approve' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Request Card Sub-Component ────────────────────────────────────────────────

function RequestCard({ req, mode, onApprove, onReject, onCancel, busy,
  expanded, onToggleDetail, detailLoading, reviews, steps }: {
  req: ApprovalRequest; mode: 'review' | 'mine'
  onApprove?: () => void; onReject?: () => void; onCancel?: () => void
  busy: boolean; expanded: boolean; onToggleDetail: () => void
  detailLoading: boolean; reviews: ReviewEntry[]; steps: StepEntry[]
}) {
  return (
    <div style={{
      background: 'var(--mm-channel-bg)', border: '1px solid var(--mm-border)',
      borderRadius: 8, overflow: 'hidden', transition: 'box-shadow 0.15s',
    }}>
      {/* Header */}
      <div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: 'var(--mm-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700, marginBottom: 4 }}>
            {req.workflow_name}
          </div>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{req.title}</h3>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--mm-muted)' }}>
            {mode === 'review' ? <>Requested by <strong>{req.requester_name || 'Unknown'}</strong> • </> : null}
            Step {req.current_step_order} • {fmtDate(req.created_at)}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {mode === 'review' && req.status === 'pending' && (
            <>
              <button disabled={busy} onClick={onReject} style={{
                padding: '5px 10px', borderRadius: 8, border: '1px solid #d24b4e',
                background: 'transparent', color: '#d24b4e', fontWeight: 600, fontSize: 12,
                cursor: busy ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                opacity: busy ? 0.5 : 1
              }}><X size={13} /> Reject</button>
              <button disabled={busy} onClick={onApprove} style={{
                padding: '5px 10px', borderRadius: 8, border: 'none',
                background: 'var(--mm-online)', color: '#fff', fontWeight: 600, fontSize: 12,
                cursor: busy ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                opacity: busy ? 0.5 : 1
              }}><Check size={13} /> Approve</button>
            </>
          )}
          {mode === 'mine' && <StatusBadge status={req.status} />}
          {mode === 'mine' && req.status === 'pending' && (
            <button disabled={busy} onClick={onCancel} title="Cancel request" style={{
              padding: '4px 8px', borderRadius: 8, border: '1px solid var(--mm-border)',
              background: 'transparent', color: 'var(--mm-muted)', cursor: 'pointer', fontSize: 11,
              display: 'flex', alignItems: 'center', gap: 4
            }}><Ban size={12} /> Cancel</button>
          )}
        </div>
      </div>

      {/* Description */}
      <div style={{ padding: '0 16px 10px', fontSize: 13, color: 'var(--fg)', lineHeight: 1.5 }}>
        {req.description.length > 200 ? req.description.slice(0, 200) + '…' : req.description}
      </div>

      {/* Expand Toggle */}
      <button type="button" onClick={onToggleDetail} style={{
        width: '100%', padding: '8px 16px', border: 'none', borderTop: '1px solid var(--mm-border-subtle)',
        background: expanded ? 'rgba(128,128,128,0.04)' : 'transparent', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--mm-link)',
        fontWeight: 600
      }}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {expanded ? 'Hide' : 'View'} Timeline & Details
      </button>

      {/* Timeline */}
      {expanded && (
        <div style={{ padding: '12px 16px 16px', borderTop: '1px solid var(--mm-border-subtle)', background: 'rgba(128,128,128,0.02)' }}>
          {detailLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--mm-muted)', fontSize: 13 }}>
              <Loader2 size={14} className="spin" /> Loading…
            </div>
          ) : (
            <>
              {/* Steps Pipeline */}
              {steps.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mm-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                    Workflow Pipeline
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                    {steps.map((s, i) => {
                      const reviewed = reviews.find(r => r.step_order === s.step_order)
                      const isCurrent = req.status === 'pending' && s.step_order === req.current_step_order
                      let bg = 'var(--mm-border-subtle)'; let fg = 'var(--mm-muted)'
                      if (reviewed?.decision === 'approved') { bg = 'rgba(56,151,141,0.15)'; fg = 'var(--mm-online)' }
                      else if (reviewed?.decision === 'rejected') { bg = 'rgba(210,75,78,0.15)'; fg = '#d24b4e' }
                      else if (isCurrent) { bg = 'rgba(245,171,0,0.15)'; fg = '#f5ab00' }
                      return (
                        <React.Fragment key={s.step_order}>
                          <div style={{ padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, background: bg, color: fg, border: isCurrent ? `1px solid ${fg}` : '1px solid transparent' }}>
                            {s.step_order}. {s.approver_username ? `@${s.approver_username}` : s.approver_role}
                            {reviewed && ` — ${reviewed.decision}`}
                          </div>
                          {i < steps.length - 1 && <ArrowRight size={12} style={{ color: 'var(--mm-muted)' }} />}
                        </React.Fragment>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Review History */}
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mm-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                Review History
              </div>
              {reviews.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--mm-muted)', margin: 0 }}>No reviews yet.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {reviews.map(rv => (
                    <div key={rv.id} style={{ display: 'flex', gap: 10, fontSize: 13 }}>
                      <div style={{ width: 4, borderRadius: 2, flexShrink: 0, background: rv.decision === 'approved' ? 'var(--mm-online)' : '#d24b4e' }} />
                      <div>
                        <div>
                          <strong>{rv.reviewer_name || rv.reviewer_username}</strong>
                          <span style={{ color: rv.decision === 'approved' ? 'var(--mm-online)' : '#d24b4e', fontWeight: 600, marginLeft: 6 }}>
                            {rv.decision === 'approved' ? 'approved' : 'rejected'}
                          </span>
                          <span style={{ color: 'var(--mm-muted)', marginLeft: 6 }}>step {rv.step_order}</span>
                        </div>
                        {rv.comment && (
                          <div style={{ marginTop: 3, color: 'var(--mm-muted)', display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                            <MessageSquare size={12} style={{ marginTop: 2, flexShrink: 0 }} /> {rv.comment}
                          </div>
                        )}
                        <div style={{ fontSize: 11, color: 'var(--mm-muted)', marginTop: 2 }}>{fmtDate(rv.created_at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
