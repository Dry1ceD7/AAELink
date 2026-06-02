import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isWorkspaceMember } from '@/lib/workspace/workspaceAccess'
import { userIsItForWorkspace } from '@/lib/enterprise/ticketAccess'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { verifyCsrf } from '@/lib/auth/csrf'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { isTicketStatus, type TicketStatus, type TicketPriority } from '@/lib/enterprise/slaEngine'
import {
  evaluateTransition,
  plannedEffects,
  isResolutionCategory,
  type ActorContext,
  type TicketSnapshot,
  type TransitionRequest,
} from '@/lib/enterprise/ticketStateMachine'

interface TicketRow {
  id: string
  workspace_id: string
  status: TicketStatus
  priority: TicketPriority
  assignee_id: string | null
  created_by: string
  resolved_by: string | null
  resolution_note: string
  resolution_category: string
  force_closed: boolean
  sla_paused_at: number
  sla_paused_total_ms: number
  sla_due_at: number
  first_response_due_at: number
}

async function _POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf

  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()

  const { id } = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Partial<TransitionRequest>

  const to = String(body.to || '').trim()
  if (!isTicketStatus(to)) {
    return NextResponse.json({ error: 'invalid_target_status' }, { status: 400 })
  }
  if (body.resolution_category && !isResolutionCategory(String(body.resolution_category))) {
    return NextResponse.json({ error: 'invalid_resolution_category' }, { status: 400 })
  }

  const { rows } = await pool.query<TicketRow>(
    `SELECT id, workspace_id, status, priority, assignee_id, created_by,
            resolved_by, resolution_note, resolution_category, force_closed,
            sla_paused_at, sla_paused_total_ms, sla_due_at, first_response_due_at
     FROM aaelink.tickets WHERE id = $1`,
    [id]
  )
  const ticket = rows[0]
  if (!ticket) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  if (!(await isWorkspaceMember(pool, uid, ticket.workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const isIt = await userIsItForWorkspace(pool, uid, ticket.workspace_id)
  const { rows: roleRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  const role = roleRows[0]?.platform_role || ''

  const actor: ActorContext = {
    user_id: uid,
    is_platform_admin: isPlatformAdmin(role),
    is_workspace_admin: isPlatformAdmin(role),
    is_it_role: isIt,
    is_assignee: ticket.assignee_id === uid,
    is_creator: ticket.created_by === uid,
  }
  const snapshot: TicketSnapshot = {
    status: ticket.status,
    priority: ticket.priority,
    assignee_id: ticket.assignee_id || '',
    created_by: ticket.created_by,
    resolved_by: ticket.resolved_by || '',
    resolution_note: ticket.resolution_note || '',
    resolution_category: ticket.resolution_category || '',
    force_closed: ticket.force_closed,
  }

  const decision = evaluateTransition(snapshot, body as TransitionRequest, actor)
  if (!decision.ok) {
    return NextResponse.json(
      { error: decision.code, hint: decision.hint, from: ticket.status, to },
      { status: 409 }
    )
  }

  const now = Date.now()
  const effects = plannedEffects(ticket.status, to as TicketStatus)

  // Compose SET clauses
  const sets: string[] = ['status = $2', 'updated_at = $3']
  const params: (string | number | null | boolean)[] = [id, to, now]
  const push = (val: string | number | null | boolean) => {
    params.push(val)
    return `$${params.length}`
  }

  if (effects.set_resolved_at) {
    sets.push(`resolved_at = ${push(now)}`)
    sets.push(`resolved_by = ${push(uid)}`)
    if (body.resolution_note) sets.push(`resolution_note = ${push(String(body.resolution_note).trim())}`)
    if (body.resolution_category) sets.push(`resolution_category = ${push(String(body.resolution_category).trim())}`)
  }
  if (effects.set_closed_at) sets.push(`closed_at = ${push(now)}`)
  if (effects.clear_closed_at) sets.push(`closed_at = ${push(0)}`)
  if (effects.pause_sla) sets.push(`sla_paused_at = ${push(now)}`)
  if (effects.resume_sla) {
    const accrued = ticket.sla_paused_at > 0 ? now - ticket.sla_paused_at : 0
    sets.push(`sla_paused_at = ${push(0)}`)
    sets.push(`sla_paused_total_ms = ${push(ticket.sla_paused_total_ms + accrued)}`)
  }
  if (body.force) sets.push(`force_closed = ${push(true)}`)

  await pool.query(`UPDATE aaelink.tickets SET ${sets.join(', ')} WHERE id = $1`, params)

  // Transition row
  await pool.query(
    `INSERT INTO aaelink.ticket_transitions
       (id, ticket_id, actor_id, from_status, to_status, reason, metadata, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      randomUUID(), id, uid, ticket.status, to,
      String(body.reason || '').trim(),
      JSON.stringify(decision.metadata),
      now,
    ]
  )

  // Activity log mirror (existing display surface relies on this table)
  await pool.query(
    `INSERT INTO aaelink.ticket_activity_log
       (id, ticket_id, actor_id, action, field_name, old_value, new_value, created_at)
     VALUES ($1,$2,$3,'transition','status',$4,$5,$6)`,
    [randomUUID(), id, uid, ticket.status, to, now]
  )

  writeAuditLog({
    pool,
    workspaceId: ticket.workspace_id,
    actorId: uid,
    actorRole: role,
    action: 'ticket.transition',
    resourceKind: 'ticket',
    resourceId: id,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
    metadata: { from: ticket.status, to, force: !!body.force, ...decision.metadata },
  })

  return NextResponse.json({ ok: true, from: ticket.status, to, effects })
}

export const POST = tracedRoute('POST', '/api/tickets/[id]/transition', _POST)
