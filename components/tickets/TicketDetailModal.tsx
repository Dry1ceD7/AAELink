'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle, ArrowDown, ArrowUp, Building, ChevronRight, ClipboardList, Clock, Copy,
  Eye, FileSignature, Link2, Lock, MessageSquare, Monitor, RefreshCw, Send, Shield, TrendingUp,
  User, Users, Wallet, X, Zap
} from 'lucide-react'
import { apiFetch } from '@/lib/api/apiClient'
import type { Ticket } from './TicketsPanel'
import {
  STATUS_CONFIG, PRIORITY_CONFIG, CATEGORY_CONFIG,
  type TicketStatus, type TicketPriority
} from '@/lib/enterprise/slaEngine'
import { TransitionDialog, type TransitionMode, type TransitionDialogResult } from '@/components/modals/TransitionDialog'
import { AssemblyIngestModal } from '@/components/documents/AssemblyIngestModal'

type URow = { id: string; username: string; first_name: string; last_name: string; nickname?: string }

interface Comment {
  id: string; ticket_id: string; author_id: string; body: string
  is_internal: boolean; created_at: number; updated_at: number
  author_username?: string; author_avatar?: string
  author_first_name?: string; author_last_name?: string
}

interface Activity {
  id: string; ticket_id: string; actor_id: string; action: string
  field_name?: string; old_value?: string; new_value?: string
  meta?: Record<string, unknown>; created_at: number
  actor_username?: string; actor_avatar?: string
}

interface Viewer { id: string; username: string; avatar_url: string }

interface DetailProps {
  ticket: Ticket
  workspaceId: string
  viewerIsIt: boolean
  onClose: () => void
  onUpdate: (ticket: Ticket) => void
  userMap: Record<string, URow>
  resolveUsers: (ids: string[]) => void
  itStaff: URow[]
}

function displayU(u: { first_name?: string; last_name?: string; username?: string }) {
  const full = `${u.first_name || ''} ${u.last_name || ''}`.trim()
  return full || u.username || '?'
}

function initials(u: { first_name?: string; last_name?: string; username?: string }) {
  const f = (u.first_name || '').charAt(0).toUpperCase()
  const l = (u.last_name || '').charAt(0).toUpperCase()
  return f && l ? `${f}${l}` : (u.username || '?').charAt(0).toUpperCase()
}

function priorityIcon(p: string) {
  switch (p) {
    case 'critical': return <AlertTriangle size={13} strokeWidth={2.5} />
    case 'high': return <ArrowUp size={13} strokeWidth={2.5} />
    case 'low': return <ArrowDown size={13} strokeWidth={2.5} />
    default: return <ChevronRight size={13} strokeWidth={2} />
  }
}

const CAT_ICON_MAP: Record<string, React.ReactNode> = {
  'clipboard-list': <ClipboardList size={13} />,
  'monitor':        <Monitor size={13} />,
  'users':          <Users size={13} />,
  'wallet':         <Wallet size={13} />,
  'trending-up':    <TrendingUp size={13} />,
  'building':       <Building size={13} />,
  'shield':         <Shield size={13} />,
}

function activityLabel(a: Activity): string {
  if (a.action === 'field_changed' && a.field_name) {
    const labels: Record<string, string> = {
      status: 'Status', priority: 'Priority', assignee_id: 'Assignee',
      title: 'Title', description: 'Description', category: 'Category'
    }
    const field = labels[a.field_name] || a.field_name
    return `changed ${field} from "${a.old_value || '—'}" to "${a.new_value || '—'}"`
  }
  const labels: Record<string, string> = {
    comment_added: 'added a comment',
    internal_note_added: 'added an internal note',
    ticket_created_from_message: 'created from chat message',
    ticket_created: 'created this ticket',
  }
  return labels[a.action] || a.action.replace(/_/g, ' ')
}

const CANNED_RESPONSES = [
  { label: 'Acknowledge', body: 'Thank you for reporting this. We are looking into it and will update you shortly.' },
  { label: 'Need info', body: 'Could you provide more details? Screenshots or steps to reproduce would help.' },
  { label: 'Resolved', body: 'This issue has been resolved. Please re-open if the problem returns.' },
]

export function TicketDetailModal({
  ticket, workspaceId, viewerIsIt, onClose, onUpdate, userMap, resolveUsers, itStaff
}: DetailProps) {
  const [comments, setComments] = useState<Comment[]>([])
  const [activity, setActivity] = useState<Activity[]>([])
  const [viewers, setViewers] = useState<Viewer[]>([])
  const [replyBody, setReplyBody] = useState('')
  const [isInternal, setIsInternal] = useState(false)
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'comments' | 'activity'>('comments')
  const [error, setError] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)
  const replyRef = useRef<HTMLTextAreaElement>(null)

  // Transition dialog state (replaces window.prompt)
  const transitionResolverRef = useRef<((r: TransitionDialogResult | null) => void) | null>(null)
  const [transitionDialog, setTransitionDialog] = useState<{
    from: TicketStatus
    to: TicketStatus
    mode: TransitionMode
    initial: Partial<TransitionDialogResult>
    error?: string
  } | null>(null)

  // Assembly ingest modal — used by the "Generate document" action
  const [assemblyModalOpen, setAssemblyModalOpen] = useState(false)

  // Load detail
  const loadDetail = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch(`/api/tickets/${encodeURIComponent(ticket.id)}`)
      if (!res.ok) { setError('Could not load ticket details.'); return }
      const data = await res.json()
      setComments(data.comments || [])
      setActivity(data.activity || [])
      setViewers(data.viewers || [])
      // Resolve user IDs from comments
      const uids = [
        ...(data.comments || []).map((c: Comment) => c.author_id),
        ...(data.activity || []).map((a: Activity) => a.actor_id),
        ticket.createdBy,
      ].filter(Boolean) as string[]
      resolveUsers(uids)
    } catch {
      setError('Failed to load ticket data.')
    } finally {
      setLoading(false)
    }
  }, [ticket.id, resolveUsers])

  useEffect(() => { void loadDetail() }, [loadDetail])

  // Send comment
  const sendComment = useCallback(async () => {
    if (!replyBody.trim() || sending) return
    setSending(true); setError('')
    try {
      const res = await apiFetch(`/api/tickets/${encodeURIComponent(ticket.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: replyBody.trim(), is_internal: isInternal })
      })
      if (!res.ok) { setError('Could not send comment.'); return }
      const data = await res.json()
      if (data.comment) setComments(prev => [...prev, data.comment])
      setReplyBody('')
      setIsInternal(false)
    } finally {
      setSending(false)
    }
  }, [replyBody, isInternal, sending, ticket.id])

  // Update ticket field. Status changes go through the guarded state machine
  // at /api/tickets/[id]/transition; everything else uses the PATCH endpoint.
  const patchTicket = useCallback(async (patch: Record<string, unknown>) => {
    setError('')

    // Status transitions — let the state machine validate them.
    if ('status' in patch && typeof patch.status === 'string' && patch.status !== ticket.status) {
      const targetStatus = patch.status as TicketStatus
      const fromStatus = (ticket.status || 'open') as TicketStatus

      const tryTransition = async (extras: Record<string, unknown>): Promise<boolean> => {
        const res = await apiFetch(`/api/tickets/${encodeURIComponent(ticket.id)}/transition`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: targetStatus, ...extras })
        })
        if (res.status === 409) {
          const j = (await res.json().catch(() => ({}))) as { error?: string; hint?: string }
          const code = String(j.error || '')
          let mode: TransitionMode | null = null
          if (code === 'resolution_note_required' || code === 'resolution_category_required') mode = 'resolve'
          else if (code === 'reopen_reason_required') mode = 'reopen'
          else if (code === 'force_close_requires_reason') mode = 'force_close'

          if (!mode) {
            setError(j.hint || j.error || 'Transition rejected.')
            return false
          }

          const collected = await new Promise<TransitionDialogResult | null>((resolve) => {
            transitionResolverRef.current = resolve
            setTransitionDialog({
              from: fromStatus,
              to: targetStatus,
              mode,
              initial: extras as Partial<TransitionDialogResult>,
              error: j.hint,
            })
          })
          if (!collected) return false
          return tryTransition({ ...extras, ...collected })
        }
        if (!res.ok) {
          try {
            const j = await res.json()
            setError(j.error || 'Update failed.')
          } catch { setError('Update failed.') }
          return false
        }
        return true
      }

      const ok = await tryTransition({})
      if (ok) void loadDetail()
      return
    }

    const res = await apiFetch(`/api/tickets/${encodeURIComponent(ticket.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    })
    if (!res.ok) {
      try {
        const j = await res.json()
        setError(j.error || 'Update failed.')
      } catch { setError('Update failed.') }
      return
    }
    const data = await res.json()
    if (data.ticket) onUpdate({ ...ticket, ...data.ticket } as Ticket)
    void loadDetail()
  }, [ticket, onUpdate, loadDetail])

  // Copy link
  const copyLink = useCallback(async () => {
    const url = `${window.location.origin}/home?team=${encodeURIComponent(workspaceId)}&module=tickets&ticket=${encodeURIComponent(ticket.id)}`
    try {
      await navigator.clipboard.writeText(url)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
    } catch { setError('Could not copy link.') }
  }, [workspaceId, ticket.id])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const priCfg = PRIORITY_CONFIG[(ticket.priority || 'medium') as TicketPriority]
  const statusCfg = STATUS_CONFIG[(ticket.status || 'open') as TicketStatus]
  const catCfg = CATEGORY_CONFIG[(ticket.category || 'general') as keyof typeof CATEGORY_CONFIG] || CATEGORY_CONFIG.general
  const sla = (() => {
    const due = ticket.sla_due_at || ticket.slaDueAt || ticket.sla_breach_at
    if (!due || due <= 0) return null
    const now = Date.now()
    if (ticket.status === 'resolved' || ticket.status === 'closed') return { text: 'SLA met', cls: 'detail-sla detail-sla--met' }
    const rem = due - now
    if (rem <= 0) return { text: 'SLA breached', cls: 'detail-sla detail-sla--breached' }
    const hrs = Math.floor(rem / 3600000); const mins = Math.floor((rem % 3600000) / 60000)
    if (hrs < 1) return { text: `${mins}m left`, cls: 'detail-sla detail-sla--warn' }
    if (hrs < 4) return { text: `${hrs}h ${mins}m left`, cls: 'detail-sla detail-sla--warn' }
    return { text: `${hrs}h ${mins}m left`, cls: 'detail-sla detail-sla--ok' }
  })()

  const content = (
    <div className="mm-modal-overlay ticket-detail-overlay" role="presentation" onClick={onClose}>
      <div
        className="ticket-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Ticket: ${ticket.title}`}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <header className="ticket-detail-header">
          <div className="ticket-detail-header-left">
            <h2 className="ticket-detail-title">{ticket.title}</h2>
            <div className="ticket-detail-meta-row">
              <span className="ticket-detail-id">{ticket.id}</span>
              <span className="ticket-detail-status-pill" style={{ background: statusCfg?.color + '22', color: statusCfg?.color }}>
                {statusCfg?.label}
              </span>
              <span className="ticket-detail-pri" style={{ color: priCfg?.color }}>
                {priorityIcon(ticket.priority)} {priCfg?.label}
              </span>
              <span className="ticket-detail-cat">{CAT_ICON_MAP[catCfg.iconKey] || <ClipboardList size={13} />} {catCfg.label}</span>
              {sla && <span className={sla.cls}><Clock size={12} strokeWidth={2} /> {sla.text}</span>}
            </div>
          </div>
          <div className="ticket-detail-header-actions">
            <button type="button" className="ticket-detail-icon-btn" onClick={() => setAssemblyModalOpen(true)} title="Generate document from this ticket">
              <FileSignature size={16} />
            </button>
            <button type="button" className="ticket-detail-icon-btn" onClick={copyLink} title="Copy link">
              <Link2 size={16} /> {linkCopied ? 'Copied!' : ''}
            </button>
            <button type="button" className="ticket-detail-icon-btn" onClick={() => void loadDetail()} title="Refresh">
              <RefreshCw size={16} className={loading ? 'spin' : ''} />
            </button>
            <button type="button" className="ticket-detail-close" onClick={onClose} aria-label="Close">
              <X size={20} strokeWidth={2} />
            </button>
          </div>
        </header>

        {/* ── Viewers / Agent collision ── */}
        {viewers.length > 0 && (
          <div className="ticket-detail-viewers">
            <Eye size={13} strokeWidth={2} />
            <span>Also viewing: {viewers.map(v => v.username).join(', ')}</span>
          </div>
        )}

        {error && (
          <div className="ticket-detail-error" role="alert">
            {error}
            <button type="button" onClick={() => setError('')} className="ticket-detail-error-dismiss">×</button>
          </div>
        )}

        {/* ── Controls (IT only) ── */}
        {viewerIsIt && (
          <div className="ticket-detail-controls">
            <label className="ticket-detail-ctrl">
              <span>Status</span>
              <select
                value={ticket.status}
                onChange={e => void patchTicket({ status: e.target.value })}
              >
                {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </label>
            <label className="ticket-detail-ctrl">
              <span>Priority</span>
              <select
                value={ticket.priority}
                onChange={e => void patchTicket({ priority: e.target.value })}
              >
                {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </label>
            <label className="ticket-detail-ctrl">
              <span>Assignee</span>
              <select
                value={ticket.assigneeId || ''}
                onChange={e => void patchTicket({ assignee_id: e.target.value || null })}
              >
                <option value="">Unassigned</option>
                {itStaff.map(u => (
                  <option key={u.id} value={u.id}>{displayU(u)} (@{u.username})</option>
                ))}
              </select>
            </label>
          </div>
        )}

        {/* ── Description ── */}
        {ticket.description && (
          <div className="ticket-detail-desc">
            <div className="ticket-detail-desc-head">
              <span className="ticket-detail-desc-avatar">
                {ticket.createdBy && userMap[ticket.createdBy] ? initials(userMap[ticket.createdBy]) : '?'}
              </span>
              <div>
                <strong>{ticket.createdBy && userMap[ticket.createdBy] ? displayU(userMap[ticket.createdBy]) : 'Author'}</strong>
                <time>{new Date(ticket.createdAt).toLocaleString()}</time>
              </div>
            </div>
            <p className="ticket-detail-desc-body">{ticket.description}</p>
          </div>
        )}

        {/* ── Tab switcher: Comments / Activity ── */}
        <div className="ticket-detail-tabs">
          <button
            className={`ticket-detail-tab${activeTab === 'comments' ? ' ticket-detail-tab--active' : ''}`}
            onClick={() => setActiveTab('comments')}
          >
            <MessageSquare size={14} /> Comments ({comments.length})
          </button>
          <button
            className={`ticket-detail-tab${activeTab === 'activity' ? ' ticket-detail-tab--active' : ''}`}
            onClick={() => setActiveTab('activity')}
          >
            <Zap size={14} /> Activity ({activity.length})
          </button>
        </div>

        {/* ── Comments thread ── */}
        {activeTab === 'comments' && (
          <div className="ticket-detail-thread">
            {loading && comments.length === 0 ? (
              <p className="ticket-detail-loading">Loading comments…</p>
            ) : comments.length === 0 ? (
              <p className="ticket-detail-empty">No comments yet. Be the first to reply.</p>
            ) : (
              comments.map(c => (
                <article key={c.id} className={`ticket-detail-comment${c.is_internal ? ' ticket-detail-comment--internal' : ''}`}>
                  <div className="ticket-detail-comment-head">
                    <span className="ticket-detail-comment-avatar">
                      {c.author_first_name || c.author_username
                        ? initials({ first_name: c.author_first_name, last_name: c.author_last_name, username: c.author_username })
                        : '?'}
                    </span>
                    <div className="ticket-detail-comment-meta">
                      <strong>{c.author_first_name ? `${c.author_first_name} ${c.author_last_name || ''}`.trim() : c.author_username || '?'}</strong>
                      {c.is_internal && (
                        <span className="ticket-detail-internal-badge"><Lock size={10} /> Internal</span>
                      )}
                      <time>{new Date(c.created_at).toLocaleString()}</time>
                    </div>
                  </div>
                  <p className="ticket-detail-comment-body">{c.body}</p>
                </article>
              ))
            )}
          </div>
        )}

        {/* ── Activity timeline ── */}
        {activeTab === 'activity' && (
          <div className="ticket-detail-activity">
            {loading && activity.length === 0 ? (
              <p className="ticket-detail-loading">Loading activity…</p>
            ) : activity.length === 0 ? (
              <p className="ticket-detail-empty">No activity recorded.</p>
            ) : (
              activity.map(a => (
                <div key={a.id} className="ticket-detail-activity-item">
                  <Zap size={12} strokeWidth={2} className="ticket-detail-activity-icon" />
                  <span className="ticket-detail-activity-actor">{a.actor_username || 'System'}</span>
                  <span className="ticket-detail-activity-action">{activityLabel(a)}</span>
                  <time className="ticket-detail-activity-time">
                    {new Date(a.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                  </time>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Reply box ── */}
        <div className="ticket-detail-reply">
          {viewerIsIt && (
            <div className="ticket-detail-canned">
              {CANNED_RESPONSES.map(cr => (
                <button key={cr.label} type="button" className="ticket-detail-canned-btn"
                  onClick={() => setReplyBody(prev => prev ? `${prev}\n\n${cr.body}` : cr.body)}
                >
                  {cr.label}
                </button>
              ))}
            </div>
          )}
          <div className="ticket-detail-reply-row">
            <textarea
              ref={replyRef}
              className="ticket-detail-reply-input"
              rows={3}
              value={replyBody}
              onChange={e => setReplyBody(e.target.value)}
              placeholder={isInternal ? 'Add an internal note (visible to IT only)…' : 'Add a comment…'}
              disabled={sending}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendComment() } }}
            />
          </div>
          <div className="ticket-detail-reply-actions">
            {viewerIsIt && (
              <label className="ticket-detail-internal-toggle">
                <input type="checkbox" checked={isInternal} onChange={e => setIsInternal(e.target.checked)} />
                <Lock size={12} /> Internal note
              </label>
            )}
            <button
              type="button"
              className="ticket-detail-send-btn"
              disabled={sending || !replyBody.trim()}
              onClick={() => void sendComment()}
            >
              <Send size={14} /> {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </div>

      {transitionDialog && (
        <TransitionDialog
          open={true}
          mode={transitionDialog.mode}
          from={transitionDialog.from}
          to={transitionDialog.to}
          initial={transitionDialog.initial}
          error={transitionDialog.error}
          onConfirm={(result) => {
            const resolve = transitionResolverRef.current
            transitionResolverRef.current = null
            setTransitionDialog(null)
            resolve?.(result)
          }}
          onCancel={() => {
            const resolve = transitionResolverRef.current
            transitionResolverRef.current = null
            setTransitionDialog(null)
            resolve?.(null)
          }}
        />
      )}

      {assemblyModalOpen && (
        <AssemblyIngestModal
          workspaceId={workspaceId}
          ticketId={ticket.id}
          initialRawText={[ticket.title, ticket.description].filter(Boolean).join('\n\n')}
          onClose={() => setAssemblyModalOpen(false)}
          onCreated={() => {
            setAssemblyModalOpen(false)
            // Reload to reveal the newly-created assembly link in the activity feed
            void loadDetail()
          }}
        />
      )}
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(content, document.body)
}
