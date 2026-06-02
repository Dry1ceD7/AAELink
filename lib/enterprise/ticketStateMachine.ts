/**
 * Ticket State Machine — Jira-grade guarded transitions.
 *
 * Every transition is evaluated by a typed guard function that returns
 * either { ok: true } or { ok: false, code, hint }. Route handlers should
 * surface guard rejections as HTTP 409 with the structured error code.
 */

import type { TicketStatus, TicketPriority } from './slaEngine'

export type TransitionCode =
  | 'invalid_transition'
  | 'assignee_required'
  | 'resolution_note_required'
  | 'resolution_category_required'
  | 'reopen_reason_required'
  | 'four_eyes_violation'
  | 'forbidden_role'
  | 'force_close_requires_reason'

export interface ActorContext {
  user_id: string
  is_platform_admin: boolean
  is_workspace_admin: boolean
  is_it_role: boolean
  is_assignee: boolean
  is_creator: boolean
}

export interface TicketSnapshot {
  status: TicketStatus
  priority: TicketPriority
  assignee_id: string
  created_by: string
  resolved_by: string
  resolution_note: string
  resolution_category: string
  force_closed: boolean
}

export interface TransitionRequest {
  to: TicketStatus
  reason?: string
  resolution_note?: string
  resolution_category?: string
  force?: boolean
}

export type GuardResult =
  | { ok: true; metadata: Record<string, unknown> }
  | { ok: false; code: TransitionCode; hint: string }

/** Resolution categories allowed on resolve. */
export const RESOLUTION_CATEGORIES = [
  'fixed',
  'workaround',
  'duplicate',
  'wont_fix',
  'cannot_reproduce',
  'user_error',
  'completed',
] as const
export type ResolutionCategory = typeof RESOLUTION_CATEGORIES[number]

export function isResolutionCategory(v: string): v is ResolutionCategory {
  return (RESOLUTION_CATEGORIES as readonly string[]).includes(v)
}

/** Graph of allowed transitions. Mirrors slaEngine.VALID_TRANSITIONS, gated. */
const GRAPH: Record<TicketStatus, TicketStatus[]> = {
  open:        ['pending', 'in_progress', 'closed'],
  pending:     ['open', 'in_progress', 'closed'],
  in_progress: ['pending', 'resolved', 'closed'],
  resolved:    ['open', 'in_progress', 'closed'],
  closed:      ['open'],
}

/** RBAC: who may move a ticket at all (any direction). */
function canActOnTicket(actor: ActorContext): boolean {
  return (
    actor.is_platform_admin ||
    actor.is_workspace_admin ||
    actor.is_it_role ||
    actor.is_assignee ||
    actor.is_creator
  )
}

/** Core guard evaluator. */
export function evaluateTransition(
  ticket: TicketSnapshot,
  req: TransitionRequest,
  actor: ActorContext
): GuardResult {
  const from = ticket.status
  const to = req.to

  if (!canActOnTicket(actor)) {
    return { ok: false, code: 'forbidden_role', hint: 'Only assignee, creator, IT, or admins may transition tickets.' }
  }

  // Force-close path: bypass graph but require admin + reason.
  if (req.force) {
    if (!(actor.is_platform_admin || actor.is_workspace_admin)) {
      return { ok: false, code: 'forbidden_role', hint: 'Force close requires admin role.' }
    }
    if (!req.reason || req.reason.trim().length < 5) {
      return { ok: false, code: 'force_close_requires_reason', hint: 'Provide a reason of at least 5 characters.' }
    }
    return { ok: true, metadata: { force_closed: true, reason: req.reason.trim() } }
  }

  if (!GRAPH[from]?.includes(to)) {
    return { ok: false, code: 'invalid_transition', hint: `Cannot move from ${from} to ${to}.` }
  }

  // Per-edge guards
  if ((from === 'open' || from === 'pending') && to === 'in_progress') {
    if (!ticket.assignee_id) {
      return { ok: false, code: 'assignee_required', hint: 'Assign a ticket owner before starting work.' }
    }
  }

  if (from === 'open' && to === 'pending') {
    if (!ticket.assignee_id) {
      return { ok: false, code: 'assignee_required', hint: 'Assign someone before moving to pending.' }
    }
  }

  if (from === 'in_progress' && to === 'resolved') {
    const note = (req.resolution_note ?? ticket.resolution_note ?? '').trim()
    if (note.length < 10) {
      return { ok: false, code: 'resolution_note_required', hint: 'Resolution note must be at least 10 characters.' }
    }
    const cat = (req.resolution_category ?? ticket.resolution_category ?? '').trim()
    if (!isResolutionCategory(cat)) {
      return { ok: false, code: 'resolution_category_required', hint: `Pick one of: ${RESOLUTION_CATEGORIES.join(', ')}.` }
    }
  }

  if (from === 'resolved' && to === 'closed') {
    // 4-eyes: closer must not be resolver, unless admin override.
    const sameActorAsResolver = ticket.resolved_by && ticket.resolved_by === actor.user_id
    if (sameActorAsResolver && !(actor.is_platform_admin || actor.is_workspace_admin)) {
      return { ok: false, code: 'four_eyes_violation', hint: 'A different user must verify and close.' }
    }
  }

  if (from === 'resolved' && to === 'in_progress') {
    if (!req.reason || req.reason.trim().length < 5) {
      return { ok: false, code: 'reopen_reason_required', hint: 'Provide a reopen reason (≥5 chars).' }
    }
  }

  if (from === 'closed' && to === 'open') {
    if (!req.reason || req.reason.trim().length < 5) {
      return { ok: false, code: 'reopen_reason_required', hint: 'Provide a reopen reason (≥5 chars).' }
    }
  }

  return { ok: true, metadata: collectMetadata(req, from, to) }
}

function collectMetadata(req: TransitionRequest, from: TicketStatus, to: TicketStatus): Record<string, unknown> {
  const md: Record<string, unknown> = { from, to }
  if (req.reason) md.reason = req.reason.trim()
  if (req.resolution_note) md.resolution_note = req.resolution_note.trim()
  if (req.resolution_category) md.resolution_category = req.resolution_category.trim()
  return md
}

/** Side-effect plan derived from a successful transition. */
export interface TransitionEffects {
  set_resolved_at: boolean
  set_resolved_by: boolean
  set_closed_at: boolean
  clear_closed_at: boolean
  stop_first_response_clock: boolean
  resume_resolution_clock: boolean
  pause_sla: boolean
  resume_sla: boolean
  recalc_sla: boolean
}

const PAUSE_STATES: TicketStatus[] = ['pending']

export function plannedEffects(from: TicketStatus, to: TicketStatus): TransitionEffects {
  const wasPaused = PAUSE_STATES.includes(from)
  const willPause = PAUSE_STATES.includes(to)
  return {
    set_resolved_at: to === 'resolved',
    set_resolved_by: to === 'resolved',
    set_closed_at: to === 'closed' || to === 'resolved',
    clear_closed_at: to === 'open' && (from === 'closed' || from === 'resolved'),
    stop_first_response_clock: to === 'in_progress',
    resume_resolution_clock: from === 'resolved' && to === 'in_progress',
    pause_sla: !wasPaused && willPause,
    resume_sla: wasPaused && !willPause,
    recalc_sla: false,
  }
}

export type { TicketStatus, TicketPriority }
