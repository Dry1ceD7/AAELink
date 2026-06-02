'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, X } from 'lucide-react'
import { RESOLUTION_CATEGORIES, type ResolutionCategory } from '@/lib/enterprise/ticketStateMachine'
import type { TicketStatus } from '@/lib/enterprise/slaEngine'

/**
 * Modal that collects the metadata required by the ticket state machine
 * (resolution note + category, reopen reason, force-close reason).
 *
 * Used in place of `window.prompt()` so the flow is keyboard accessible,
 * focus-trapped, and styled. The dialog is dismissed on success or cancel.
 */

export type TransitionMode = 'resolve' | 'reopen' | 'force_close'

export interface TransitionDialogResult {
  resolution_note?: string
  resolution_category?: ResolutionCategory
  reason?: string
  force?: boolean
}

interface Props {
  open: boolean
  mode: TransitionMode
  /** From-status for context in the title/copy. */
  from: TicketStatus
  /** To-status the user picked. */
  to: TicketStatus
  /** Pre-fill values when re-prompting after a partial 409 response. */
  initial?: Partial<TransitionDialogResult>
  /** Optional inline error (e.g. server hint from a previous 409). */
  error?: string
  busy?: boolean
  onConfirm: (result: TransitionDialogResult) => void
  onCancel: () => void
}

const CATEGORY_LABELS: Record<ResolutionCategory, string> = {
  fixed: 'Fixed',
  workaround: 'Workaround applied',
  duplicate: 'Duplicate of another ticket',
  wont_fix: 'Won’t fix',
  cannot_reproduce: 'Cannot reproduce',
  user_error: 'User error',
  completed: 'Completed',
}

function titleFor(mode: TransitionMode, to: TicketStatus): string {
  if (mode === 'resolve') return `Resolve ticket → ${to}`
  if (mode === 'reopen') return `Reopen ticket → ${to}`
  return `Force close ticket → ${to}`
}

function leadFor(mode: TransitionMode): string {
  if (mode === 'resolve') return 'Document what changed and pick the resolution category. The note must be at least 10 characters.'
  if (mode === 'reopen') return 'Why is this ticket coming back? At least 5 characters.'
  return 'Force close bypasses the normal workflow. Provide a reason for the audit trail (≥5 chars).'
}

export function TransitionDialog({
  open, mode, from, to, initial, error, busy, onConfirm, onCancel,
}: Props) {
  const [note, setNote] = useState(initial?.resolution_note || '')
  const [category, setCategory] = useState<ResolutionCategory>(
    (initial?.resolution_category as ResolutionCategory) || 'fixed'
  )
  const [reason, setReason] = useState(initial?.reason || '')
  const [touched, setTouched] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const firstInputRef = useRef<HTMLTextAreaElement | null>(null)

  // Reset on open
  useEffect(() => {
    if (open) {
      setNote(initial?.resolution_note || '')
      setCategory((initial?.resolution_category as ResolutionCategory) || 'fixed')
      setReason(initial?.reason || '')
      setTouched(false)
      requestAnimationFrame(() => firstInputRef.current?.focus())
    }
  }, [open, mode, initial])

  // Esc to cancel + focus trap
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
        return
      }
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const nodes = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter(el => el.offsetParent !== null || el === document.activeElement)
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open || typeof document === 'undefined') return null

  const noteValid = mode !== 'resolve' || note.trim().length >= 10
  const reasonValid = (mode !== 'reopen' && mode !== 'force_close') || reason.trim().length >= 5
  const valid = noteValid && reasonValid

  const submit = () => {
    setTouched(true)
    if (!valid) return
    if (mode === 'resolve') {
      onConfirm({ resolution_note: note.trim(), resolution_category: category })
    } else if (mode === 'reopen') {
      onConfirm({ reason: reason.trim() })
    } else {
      onConfirm({ reason: reason.trim(), force: true })
    }
  }

  return createPortal(
    <div className="mm-modal-overlay" role="presentation" onClick={onCancel}>
      <div
        ref={panelRef}
        className="mm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transition-dialog-title"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 520 }}
      >
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 id="transition-dialog-title" style={{ margin: 0, fontSize: 16 }}>{titleFor(mode, to)}</h2>
          <button type="button" className="ghost-button" aria-label="Close" onClick={onCancel}><X size={16} /></button>
        </header>

        <p className="mm-editor-hint" style={{ margin: '0 0 12px', fontSize: 13 }}>{leadFor(mode)}</p>
        <p className="mm-editor-hint" style={{ margin: '0 0 12px', fontSize: 12, opacity: 0.7 }}>
          From <strong>{from}</strong> → <strong>{to}</strong>
        </p>

        {error && (
          <div className="mm-auth-alert mm-auth-alert--error" role="alert" style={{ marginBottom: 12 }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {mode === 'resolve' && (
          <>
            <label className="field-label" htmlFor="transition-note">
              Resolution note <span style={{ opacity: 0.6 }}>(≥10 chars)</span>
              <textarea
                id="transition-note"
                ref={firstInputRef}
                className="slack-input"
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={4}
                placeholder="What did you do to resolve this?"
                aria-invalid={touched && !noteValid}
                aria-describedby={touched && !noteValid ? 'transition-note-err' : undefined}
                style={{ resize: 'vertical', minHeight: 80 }}
              />
            </label>
            {touched && !noteValid && (
              <p id="transition-note-err" role="alert" style={{ color: 'var(--aae-danger, #d24b4e)', fontSize: 12, margin: '4px 0 0' }}>
                Resolution note must be at least 10 characters.
              </p>
            )}
            <label className="field-label" htmlFor="transition-category" style={{ marginTop: 12 }}>
              Category
              <select
                id="transition-category"
                className="slack-input"
                value={category}
                onChange={e => setCategory(e.target.value as ResolutionCategory)}
              >
                {RESOLUTION_CATEGORIES.map(cat => (
                  <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
                ))}
              </select>
            </label>
          </>
        )}

        {(mode === 'reopen' || mode === 'force_close') && (
          <label className="field-label" htmlFor="transition-reason">
            Reason <span style={{ opacity: 0.6 }}>(≥5 chars)</span>
            <textarea
              id="transition-reason"
              ref={firstInputRef}
              className="slack-input"
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              placeholder={mode === 'reopen' ? 'Why is this returning?' : 'Why is this being force-closed?'}
              aria-invalid={touched && !reasonValid}
              aria-describedby={touched && !reasonValid ? 'transition-reason-err' : undefined}
              style={{ resize: 'vertical', minHeight: 60 }}
            />
          </label>
        )}
        {touched && !reasonValid && (
          <p id="transition-reason-err" role="alert" style={{ color: 'var(--aae-danger, #d24b4e)', fontSize: 12, margin: '4px 0 0' }}>
            Reason must be at least 5 characters.
          </p>
        )}

        <div className="mm-modal-actions" style={{ marginTop: 16 }}>
          <button type="button" className="ghost-button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="slack-button"
            onClick={submit}
            disabled={busy}
            style={mode === 'force_close' ? { background: 'var(--aae-danger, #d24b4e)' } : undefined}
          >
            {busy ? 'Working…' : (mode === 'resolve' ? 'Resolve' : mode === 'reopen' ? 'Reopen' : 'Force close')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
