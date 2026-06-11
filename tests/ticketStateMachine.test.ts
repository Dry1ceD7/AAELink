/**
 * Ticket State Machine — guard rule coverage.
 */
import { describe, it, expect } from 'vitest'
import {
  evaluateTransition, plannedEffects, isResolutionCategory,
  type ActorContext, type TicketSnapshot, type TransitionRequest,
} from '@/lib/enterprise/ticketStateMachine'

function actor(over: Partial<ActorContext> = {}): ActorContext {
  return {
    user_id: 'u1',
    is_platform_admin: false,
    is_workspace_admin: false,
    is_it_role: true,
    is_assignee: true,
    is_creator: false,
    ...over,
  }
}
function snap(over: Partial<TicketSnapshot> = {}): TicketSnapshot {
  return {
    status: 'open',
    priority: 'medium',
    assignee_id: 'u1',
    created_by: 'u0',
    resolved_by: '',
    resolution_note: '',
    resolution_category: '',
    force_closed: false,
    ...over,
  }
}
function req(over: Partial<TransitionRequest> & { to: TransitionRequest['to'] }): TransitionRequest {
  return { ...over }
}

describe('state machine — basic graph', () => {
  it('allows open → pending with assignee', () => {
    const r = evaluateTransition(snap({ status: 'open' }), req({ to: 'pending' }), actor())
    expect(r.ok).toBe(true)
  })
  it('rejects open → resolved (not in graph)', () => {
    const r = evaluateTransition(snap({ status: 'open' }), req({ to: 'resolved' }), actor())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('invalid_transition')
  })
  it('rejects open → pending without assignee', () => {
    const r = evaluateTransition(snap({ status: 'open', assignee_id: '' }), req({ to: 'pending' }), actor())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('assignee_required')
  })
})

describe('state machine — resolve gate', () => {
  it('rejects without resolution_note', () => {
    const r = evaluateTransition(snap({ status: 'in_progress' }), req({ to: 'resolved', resolution_category: 'fixed' }), actor())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('resolution_note_required')
  })
  it('rejects without resolution_category', () => {
    const r = evaluateTransition(snap({ status: 'in_progress' }), req({ to: 'resolved', resolution_note: 'Did the thing.' }), actor())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('resolution_category_required')
  })
  it('accepts with both', () => {
    const r = evaluateTransition(snap({ status: 'in_progress' }), req({ to: 'resolved', resolution_note: 'Did the thing.', resolution_category: 'fixed' }), actor())
    expect(r.ok).toBe(true)
  })
})

describe('state machine — 4-eyes close', () => {
  it('rejects same actor closing their own resolve', () => {
    const r = evaluateTransition(
      snap({ status: 'resolved', resolved_by: 'u1' }),
      req({ to: 'closed' }),
      actor({ user_id: 'u1' })
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('four_eyes_violation')
  })
  it('allows different actor', () => {
    const r = evaluateTransition(
      snap({ status: 'resolved', resolved_by: 'uX' }),
      req({ to: 'closed' }),
      actor({ user_id: 'u1' })
    )
    expect(r.ok).toBe(true)
  })
  it('admin can override 4-eyes', () => {
    const r = evaluateTransition(
      snap({ status: 'resolved', resolved_by: 'u1' }),
      req({ to: 'closed' }),
      actor({ user_id: 'u1', is_platform_admin: true })
    )
    expect(r.ok).toBe(true)
  })
})

describe('state machine — reopen', () => {
  it('rejects closed → open without reason', () => {
    const r = evaluateTransition(snap({ status: 'closed' }), req({ to: 'open' }), actor())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('reopen_reason_required')
  })
  it('rejects resolved → in_progress without reason', () => {
    const r = evaluateTransition(snap({ status: 'resolved' }), req({ to: 'in_progress' }), actor())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('reopen_reason_required')
  })
  it('allows reopen with reason', () => {
    const r = evaluateTransition(snap({ status: 'closed' }), req({ to: 'open', reason: 'Regression seen' }), actor())
    expect(r.ok).toBe(true)
  })
})

describe('state machine — force close', () => {
  it('rejects non-admin force', () => {
    const r = evaluateTransition(snap({ status: 'in_progress' }), req({ to: 'closed', force: true, reason: 'admin call' }), actor())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('forbidden_role')
  })
  it('admin force-close bypasses graph but requires reason', () => {
    const a = actor({ is_platform_admin: true })
    const r1 = evaluateTransition(snap({ status: 'in_progress' }), req({ to: 'closed', force: true }), a)
    expect(r1.ok).toBe(false)
    const r2 = evaluateTransition(snap({ status: 'in_progress' }), req({ to: 'closed', force: true, reason: 'duplicate' }), a)
    expect(r2.ok).toBe(true)
  })
})

describe('state machine — RBAC', () => {
  it('rejects when actor is none of (assignee, creator, IT, admin)', () => {
    const a = actor({ is_it_role: false, is_assignee: false, is_creator: false })
    const r = evaluateTransition(snap({ status: 'open' }), req({ to: 'pending' }), a)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('forbidden_role')
  })
})

describe('plannedEffects', () => {
  it('resolves set marks', () => {
    const e = plannedEffects('in_progress', 'resolved')
    expect(e.set_resolved_at).toBe(true)
    expect(e.set_closed_at).toBe(true)
  })
  it('open ← closed clears closed_at', () => {
    const e = plannedEffects('closed', 'open')
    expect(e.clear_closed_at).toBe(true)
  })
  it('pause when entering pending', () => {
    const e = plannedEffects('open', 'pending')
    expect(e.pause_sla).toBe(true)
  })
  it('resume when leaving pending', () => {
    const e = plannedEffects('pending', 'in_progress')
    expect(e.resume_sla).toBe(true)
  })
})

describe('isResolutionCategory', () => {
  it.each(['fixed', 'workaround', 'duplicate', 'wont_fix', 'cannot_reproduce', 'user_error', 'completed'])('accepts %s', v => {
    expect(isResolutionCategory(v)).toBe(true)
  })
  it.each(['', 'unknown', 'CLOSED'])('rejects %s', v => {
    expect(isResolutionCategory(v)).toBe(false)
  })
})
