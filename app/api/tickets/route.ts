import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { isWorkspaceMember } from '@/lib/workspaceAccess'
import { getMemberDepartmentId, userIsItForWorkspace } from '@/lib/ticketAccess'
import { tracedRoute } from '@/lib/tracedRoute'
import {
  isTicketPriority, isTicketStatus, isTicketCategory, isTicketSource,
  calculateSlaDue, isValidTransition,
  type TicketPriority, type TicketStatus, type TicketCategory
} from '@/lib/slaEngine'

// ── GET /api/tickets — list tickets ─────────────────────────────────────────

async function _GET(req: Request) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()

  const url = new URL(req.url)
  const workspaceId = url.searchParams.get('workspace_id')?.trim()
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  if (!(await isWorkspaceMember(pool, uid, workspaceId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const isIt = await userIsItForWorkspace(pool, uid, workspaceId)
  const userDept = await getMemberDepartmentId(pool, uid, workspaceId)

  // Filters
  const statusFilter = url.searchParams.get('status')?.trim() || ''
  const priorityFilter = url.searchParams.get('priority')?.trim() || ''
  const categoryFilter = url.searchParams.get('category')?.trim() || ''
  const assigneeFilter = url.searchParams.get('assignee_id')?.trim() || ''
  const searchQuery = url.searchParams.get('q')?.trim() || ''
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200)
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0)

  const where: string[] = ['t.workspace_id = $1']
  const params: (string | number)[] = [workspaceId]

  // Visibility: IT sees all; others see own dept + own tickets
  if (!isIt) {
    if (userDept) {
      params.push(userDept, uid)
      where.push(`(t.department_id = $${params.length - 1} OR t.created_by = $${params.length} OR t.assignee_id = $${params.length})`)
    } else {
      params.push(uid)
      where.push(`(t.created_by = $${params.length} OR t.assignee_id = $${params.length})`)
    }
  }

  if (statusFilter && isTicketStatus(statusFilter)) {
    params.push(statusFilter)
    where.push(`t.status = $${params.length}`)
  }
  if (priorityFilter && isTicketPriority(priorityFilter)) {
    params.push(priorityFilter)
    where.push(`t.priority = $${params.length}`)
  }
  if (categoryFilter && isTicketCategory(categoryFilter)) {
    params.push(categoryFilter)
    where.push(`t.category = $${params.length}`)
  }
  if (assigneeFilter) {
    params.push(assigneeFilter)
    where.push(`t.assignee_id = $${params.length}`)
  }
  if (searchQuery) {
    params.push(`%${searchQuery}%`)
    where.push(`(t.title ILIKE $${params.length} OR t.description ILIKE $${params.length})`)
  }

  const whereClause = where.join(' AND ')

  // Count
  const { rows: cntRows } = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM aaelink.tickets t WHERE ${whereClause}`, params
  )
  const total = Number(cntRows[0]?.cnt || 0)

  // Fetch
  params.push(limit, offset)
  const { rows } = await pool.query<{
    id: string; title: string; description: string; status: string;
    priority: string; category: string; source: string;
    createdBy: string; departmentId: string | null;
    departmentCode: string; departmentName: string;
    assigneeId: string | null; assigneeUsername: string; assigneeAvatar: string;
    creatorUsername: string; creatorAvatar: string;
    tags: string; customFields: string;
    slaDueAt: number; closedAt: number;
    sourceMessageId: string;
    createdAt: number; updatedAt: number;
    commentCount: number;
  }>(
    `SELECT t.id, t.title, t.description, t.status, t.priority, t.category, t.source,
            t.created_by AS "createdBy",
            t.department_id AS "departmentId", d.code AS "departmentCode", d.name AS "departmentName",
            t.assignee_id AS "assigneeId",
            ua.username AS "assigneeUsername", ua.avatar_url AS "assigneeAvatar",
            uc.username AS "creatorUsername", uc.avatar_url AS "creatorAvatar",
            t.tags, t.custom_fields AS "customFields",
            t.sla_due_at AS "slaDueAt", t.closed_at AS "closedAt",
            t.source_message_id AS "sourceMessageId",
            t.created_at AS "createdAt", t.updated_at AS "updatedAt",
            (SELECT COUNT(*)::int FROM aaelink.ticket_comments tc WHERE tc.ticket_id = t.id) AS "commentCount"
     FROM aaelink.tickets t
     LEFT JOIN aaelink.departments d ON d.id = t.department_id
     LEFT JOIN aaelink.users ua ON ua.id = t.assignee_id
     LEFT JOIN aaelink.users uc ON uc.id = t.created_by
     WHERE ${whereClause}
     ORDER BY
       CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       t.updated_at DESC, t.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )

  const tickets = rows.map(r => ({
    ...r,
    createdAt: Number(r.createdAt),
    updatedAt: Number(r.updatedAt),
    slaDueAt: Number(r.slaDueAt),
    closedAt: Number(r.closedAt),
  }))

  return NextResponse.json({
    tickets,
    total,
    limit,
    offset,
    has_more: offset + tickets.length < total,
    meta: { viewer_is_it: isIt }
  })
}

// ── POST /api/tickets — create a ticket ─────────────────────────────────────

async function _POST(req: Request) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()

  const body = (await req.json()) as {
    workspace_id?: string
    title?: string
    description?: string
    priority?: string
    category?: string
    tags?: string[]
    source?: string
    custom_fields?: Record<string, unknown>
    source_message_id?: string
    source_channel_id?: string
  }

  const workspaceId = String(body.workspace_id || '').trim()
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  if (!(await isWorkspaceMember(pool, uid, workspaceId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const title = String(body.title || '').trim()
  if (!title) return NextResponse.json({ error: 'title_required' }, { status: 400 })
  const description = String(body.description || '').trim()
  const priority: TicketPriority = body.priority && isTicketPriority(body.priority) ? body.priority : 'medium'
  const category: TicketCategory = body.category && isTicketCategory(body.category) ? body.category : 'general'
  const source = body.source && isTicketSource(body.source) ? body.source : 'ui'
  const tags = Array.isArray(body.tags) ? body.tags.map(String).slice(0, 10) : []
  const customFields = body.custom_fields && typeof body.custom_fields === 'object' ? body.custom_fields : {}
  const sourceMessageId = String(body.source_message_id || '').trim()
  const sourceChannelId = String(body.source_channel_id || '').trim()

  const now = Date.now()
  const id = `T-${now}-${Math.random().toString(36).slice(2, 8)}`
  const deptId = await getMemberDepartmentId(pool, uid, workspaceId)
  const slaDueAt = calculateSlaDue(now, priority)

  await pool.query(
    `INSERT INTO aaelink.tickets
       (id, workspace_id, title, description, status, priority, category, source,
        created_at, updated_at, created_by, department_id, tags, custom_fields,
        sla_due_at, source_message_id, source_channel_id)
     VALUES ($1,$2,$3,$4,'open',$5,$6,$7,$8,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [id, workspaceId, title, description, priority, category, source,
     now, uid, deptId, JSON.stringify(tags), JSON.stringify(customFields),
     slaDueAt, sourceMessageId, sourceChannelId]
  )

  // Activity log: ticket created
  await pool.query(
    `INSERT INTO aaelink.ticket_activity_log (id, ticket_id, actor_id, action, created_at)
     VALUES ($1, $2, $3, 'ticket_created', $4)`,
    [randomUUID(), id, uid, now]
  )

  return NextResponse.json({
    ticket: {
      id, workspace_id: workspaceId, title, description,
      status: 'open' as const, priority, category, source,
      createdBy: uid, departmentId: deptId, tags, customFields,
      slaDueAt, sourceMessageId, sourceChannelId,
      createdAt: now, updatedAt: now
    }
  })
}

// ── PATCH /api/tickets — update ticket status, assignment, priority, fields ──

async function _PATCH(req: Request) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()

  const body = (await req.json()) as {
    ticket_id?: string
    status?: string
    priority?: string
    assignee_id?: string | null
    category?: string
    custom_fields?: Record<string, unknown>
    tags?: string[]
  }

  const ticketId = String(body.ticket_id || '').trim()
  if (!ticketId) return NextResponse.json({ error: 'ticket_id_required' }, { status: 400 })

  // Load ticket
  const { rows: tRows } = await pool.query<{
    id: string; workspace_id: string; status: string; priority: string;
    assignee_id: string; category: string; created_by: string; department_id: string
  }>(`SELECT * FROM aaelink.tickets WHERE id = $1`, [ticketId])

  const ticket = tRows[0]
  if (!ticket) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Permission check
  if (!(await isWorkspaceMember(pool, uid, ticket.workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const isIt = await userIsItForWorkspace(pool, uid, ticket.workspace_id)
  const isOwner = ticket.created_by === uid
  const isAssignee = ticket.assignee_id === uid
  if (!isIt && !isOwner && !isAssignee) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const now = Date.now()
  const changes: { field: string; old: string; new_val: string }[] = []
  const updates: string[] = ['updated_at = $2']
  const params: (string | number | null)[] = [ticketId, now]

  // Status change
  if (body.status && isTicketStatus(body.status) && body.status !== ticket.status) {
    if (!isValidTransition(ticket.status as TicketStatus, body.status as TicketStatus)) {
      return NextResponse.json({ error: 'invalid_status_transition', from: ticket.status, to: body.status }, { status: 400 })
    }
    changes.push({ field: 'status', old: ticket.status, new_val: body.status })
    params.push(body.status)
    updates.push(`status = $${params.length}`)

    // Set closed_at when transitioning to closed/resolved
    if (body.status === 'closed' || body.status === 'resolved') {
      params.push(now)
      updates.push(`closed_at = $${params.length}`)
    }
    // Clear closed_at when reopening
    if (body.status === 'open' && (ticket.status === 'closed' || ticket.status === 'resolved')) {
      params.push(0)
      updates.push(`closed_at = $${params.length}`)
    }
  }

  // Priority change
  if (body.priority && isTicketPriority(body.priority) && body.priority !== ticket.priority) {
    changes.push({ field: 'priority', old: ticket.priority, new_val: body.priority })
    params.push(body.priority)
    updates.push(`priority = $${params.length}`)
    // Recalculate SLA
    const newSla = calculateSlaDue(now, body.priority as TicketPriority)
    params.push(newSla)
    updates.push(`sla_due_at = $${params.length}`)
  }

  // Assignee change
  if (body.assignee_id !== undefined) {
    const newAssignee = body.assignee_id === null ? '' : String(body.assignee_id).trim()
    if (newAssignee !== (ticket.assignee_id || '')) {
      changes.push({ field: 'assignee_id', old: ticket.assignee_id || '', new_val: newAssignee })
      params.push(newAssignee || null)
      updates.push(`assignee_id = $${params.length}`)
    }
  }

  // Category change
  if (body.category && isTicketCategory(body.category) && body.category !== ticket.category) {
    changes.push({ field: 'category', old: ticket.category, new_val: body.category })
    params.push(body.category)
    updates.push(`category = $${params.length}`)
  }

  // Custom fields
  if (body.custom_fields && typeof body.custom_fields === 'object') {
    params.push(JSON.stringify(body.custom_fields))
    updates.push(`custom_fields = $${params.length}`)
  }

  // Tags
  if (Array.isArray(body.tags)) {
    params.push(JSON.stringify(body.tags.map(String).slice(0, 10)))
    updates.push(`tags = $${params.length}`)
  }

  if (updates.length <= 1) {
    return NextResponse.json({ error: 'no_changes' }, { status: 400 })
  }

  await pool.query(`UPDATE aaelink.tickets SET ${updates.join(', ')} WHERE id = $1`, params)

  // Activity log for each change
  for (const change of changes) {
    await pool.query(
      `INSERT INTO aaelink.ticket_activity_log (id, ticket_id, actor_id, action, field_name, old_value, new_value, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [randomUUID(), ticketId, uid, `field_changed`, change.field, change.old, change.new_val, now]
    )
  }

  return NextResponse.json({ ok: true, changes: changes.length })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/tickets', _GET)
export const POST   = tracedRoute('POST', '/api/tickets', _POST)
export const PATCH  = tracedRoute('PATCH', '/api/tickets', _PATCH)
