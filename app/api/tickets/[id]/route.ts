import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { isWorkspaceMember } from '@/lib/workspaceAccess'
import { canViewTicket, userIsItForWorkspace } from '@/lib/ticketAccess'
import { isTicketStatus, isTicketPriority, isValidTransition, calculateSlaDue, type TicketPriority, type TicketStatus } from '@/lib/slaEngine'
import { notifyTicketAssignment, notifyTicketStatusChange } from '@/lib/notificationsServer'
import { tracedRoute } from '@/lib/tracedRoute'

// ── GET /api/tickets/[id] — detailed view with comments + activity + viewers ─

async function _GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()
  const { id } = await ctx.params

  const { rows: tRows } = await pool.query<{
    id: string; workspace_id: string; title: string; description: string;
    status: string; priority: string; category: string; source: string;
    created_by: string; assignee_id: string | null; department_id: string | null;
    tags: string; custom_fields: string; sla_due_at: number; closed_at: number;
    created_at: number; updated_at: number; viewer_ids: string[];
    source_message_id: string; source_channel_id: string;
    department_code: string; department_name: string;
    creator_username: string; creator_avatar: string;
    creator_first_name: string; creator_last_name: string;
    assignee_username: string; assignee_avatar: string;
    assignee_first_name: string; assignee_last_name: string;
  }>(
    `SELECT t.*,
            d.code AS department_code, d.name AS department_name,
            uc.username AS creator_username, uc.avatar_url AS creator_avatar,
            uc.first_name AS creator_first_name, uc.last_name AS creator_last_name,
            ua.username AS assignee_username, ua.avatar_url AS assignee_avatar,
            ua.first_name AS assignee_first_name, ua.last_name AS assignee_last_name
     FROM aaelink.tickets t
     LEFT JOIN aaelink.departments d ON d.id = t.department_id
     LEFT JOIN aaelink.users uc ON uc.id = t.created_by
     LEFT JOIN aaelink.users ua ON ua.id = t.assignee_id
     WHERE t.id = $1`,
    [id]
  )

  const ticket = tRows[0]
  if (!ticket?.workspace_id) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  if (!(await isWorkspaceMember(pool, uid, ticket.workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  if (!(await canViewTicket(pool, uid, {
    workspace_id: ticket.workspace_id,
    department_id: ticket.department_id,
    created_by: ticket.created_by,
    assignee_id: ticket.assignee_id,
  }))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const isIt = await userIsItForWorkspace(pool, uid, ticket.workspace_id)

  // Track viewer (agent collision)
  try {
    await pool.query(
      `UPDATE aaelink.tickets SET viewer_ids = array_append(
        array_remove(viewer_ids, $2), $2
      ) WHERE id = $1`,
      [id, uid]
    )
  } catch { /* best-effort */ }

  // Load comments with author info
  const { rows: comments } = await pool.query<{
    id: string; ticket_id: string; author_id: string; body: string;
    is_internal: boolean; created_at: number; updated_at: number;
    author_username: string; author_avatar: string;
    author_first_name: string; author_last_name: string;
  }>(
    `SELECT c.*, u.username AS author_username, u.avatar_url AS author_avatar,
            u.first_name AS author_first_name, u.last_name AS author_last_name
     FROM aaelink.ticket_comments c
     LEFT JOIN aaelink.users u ON u.id = c.author_id
     WHERE c.ticket_id = $1
     ORDER BY c.created_at ASC`,
    [id]
  )

  // Load activity log
  const { rows: activity } = await pool.query<{
    id: string; ticket_id: string; actor_id: string; action: string;
    field_name: string; old_value: string; new_value: string;
    meta: string; created_at: number;
    actor_username: string; actor_avatar: string;
  }>(
    `SELECT a.*, u.username AS actor_username, u.avatar_url AS actor_avatar
     FROM aaelink.ticket_activity_log a
     LEFT JOIN aaelink.users u ON u.id = a.actor_id
     WHERE a.ticket_id = $1
     ORDER BY a.created_at ASC`,
    [id]
  )

  // Load current viewers (agent collision display)
  const viewerIds = (ticket.viewer_ids || []).filter(v => v !== uid)
  let viewers: { id: string; username: string; avatar_url: string }[] = []
  if (viewerIds.length > 0) {
    const { rows: vRows } = await pool.query<{ id: string; username: string; avatar_url: string }>(
      `SELECT id, username, avatar_url FROM aaelink.users WHERE id = ANY($1)`,
      [viewerIds]
    )
    viewers = vRows
  }

  // Also try loading legacy ticket_messages if the table exists
  let legacyMessages: { id: string; userId: string; body: string; createdAt: number }[] = []
  try {
    const { rows: msgs } = await pool.query<{ id: string; userId: string; body: string; createdAt: number }>(
      `SELECT id, user_id AS "userId", body, created_at AS "createdAt" FROM aaelink.ticket_messages
       WHERE ticket_id = $1 ORDER BY created_at ASC`, [id]
    )
    legacyMessages = msgs.map(m => ({ id: m.id, userId: m.userId, body: m.body, createdAt: Number(m.createdAt) }))
  } catch { /* table may not exist */ }

  return NextResponse.json({
    ticket: {
      ...ticket,
      created_at: Number(ticket.created_at),
      updated_at: Number(ticket.updated_at),
      sla_due_at: Number(ticket.sla_due_at || 0),
      closed_at: Number(ticket.closed_at || 0),
    },
    comments: comments.map(c => ({ ...c, created_at: Number(c.created_at), updated_at: Number(c.updated_at) })),
    activity: activity.map(a => ({ ...a, created_at: Number(a.created_at) })),
    messages: legacyMessages,
    viewers,
    meta: { viewer_is_it: isIt }
  })
}

// ── POST /api/tickets/[id] — add comment ────────────────────────────────────

async function _POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()
  const { id: ticketId } = await ctx.params

  const { rows: tRows } = await pool.query<{
    workspace_id: string; department_id: string | null; created_by: string; assignee_id: string | null
  }>(`SELECT workspace_id, department_id, created_by, assignee_id FROM aaelink.tickets WHERE id = $1`, [ticketId])
  const ticket = tRows[0]
  if (!ticket) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!(await canViewTicket(pool, uid, ticket))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as { body?: string; is_internal?: boolean }
  const commentBody = String(body.body || '').trim()
  if (!commentBody) return NextResponse.json({ error: 'body_required' }, { status: 400 })
  const isInternal = Boolean(body.is_internal)

  const now = Date.now()
  const commentId = randomUUID()

  await pool.query(
    `INSERT INTO aaelink.ticket_comments (id, ticket_id, author_id, body, is_internal, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [commentId, ticketId, uid, commentBody, isInternal, now]
  )
  await pool.query(`UPDATE aaelink.tickets SET updated_at = $1 WHERE id = $2`, [now, ticketId])

  // Activity log
  await pool.query(
    `INSERT INTO aaelink.ticket_activity_log (id, ticket_id, actor_id, action, meta, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), ticketId, uid, isInternal ? 'internal_note_added' : 'comment_added',
     JSON.stringify({ comment_id: commentId }), now]
  )

  const { rows: uRows } = await pool.query<{ username: string; avatar_url: string; first_name: string; last_name: string }>(
    `SELECT username, avatar_url, first_name, last_name FROM aaelink.users WHERE id = $1`, [uid]
  )

  return NextResponse.json({
    comment: {
      id: commentId, ticket_id: ticketId, author_id: uid,
      body: commentBody, is_internal: isInternal,
      created_at: now, updated_at: now,
      author_username: uRows[0]?.username, author_avatar: uRows[0]?.avatar_url,
      author_first_name: uRows[0]?.first_name, author_last_name: uRows[0]?.last_name,
    }
  })
}

// ── PATCH /api/tickets/[id] — update ticket fields ──────────────────────────

async function _PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()
  const { id } = await ctx.params

  const { rows: tw } = await pool.query<{
    workspace_id: string | null; department_id: string | null; created_by: string | null;
    status: string; priority: string; assignee_id: string | null; category: string; title: string
  }>(`SELECT workspace_id, department_id, created_by, status, priority, assignee_id, category, title FROM aaelink.tickets WHERE id = $1`, [id])

  const t0 = tw[0]
  if (!t0?.workspace_id) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!(await isWorkspaceMember(pool, uid, t0.workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  if (!(await canViewTicket(pool, uid, t0))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const isIt = await userIsItForWorkspace(pool, uid, t0.workspace_id)
  const body = (await req.json()) as {
    status?: string; priority?: string; title?: string; description?: string;
    tags?: string[]; assignee_id?: string | null; category?: string; custom_fields?: Record<string, unknown>
  }

  // Only IT can change status, priority, assignee
  if ((body.status !== undefined || body.priority !== undefined || body.assignee_id !== undefined) && !isIt) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const now = Date.now()
  const changes: { field: string; old: string; new_val: string }[] = []
  const updates: string[] = []
  const params: (string | number | null)[] = []

  if (body.status !== undefined && isTicketStatus(body.status) && body.status !== t0.status) {
    if (!isValidTransition(t0.status as TicketStatus, body.status as TicketStatus)) {
      return NextResponse.json({ error: 'invalid_status_transition', from: t0.status, to: body.status }, { status: 400 })
    }
    changes.push({ field: 'status', old: t0.status, new_val: body.status })
    params.push(body.status)
    updates.push(`status = $${params.length}`)
    if (body.status === 'closed' || body.status === 'resolved') {
      params.push(now); updates.push(`closed_at = $${params.length}`)
    }
    if (body.status === 'open' && (t0.status === 'closed' || t0.status === 'resolved')) {
      params.push(0); updates.push(`closed_at = $${params.length}`)
    }
  }

  if (body.priority !== undefined && isTicketPriority(body.priority) && body.priority !== t0.priority) {
    changes.push({ field: 'priority', old: t0.priority, new_val: body.priority })
    params.push(body.priority); updates.push(`priority = $${params.length}`)
    const newSla = calculateSlaDue(now, body.priority as TicketPriority)
    params.push(newSla); updates.push(`sla_due_at = $${params.length}`)
  }

  if (body.assignee_id !== undefined) {
    const newA = body.assignee_id === null ? '' : String(body.assignee_id).trim()
    if (newA !== (t0.assignee_id || '')) {
      changes.push({ field: 'assignee_id', old: t0.assignee_id || '', new_val: newA })
      params.push(newA || null); updates.push(`assignee_id = $${params.length}`)
    }
  }

  if (body.title !== undefined) {
    const t = String(body.title).trim()
    if (!t) return NextResponse.json({ error: 'title_required' }, { status: 400 })
    params.push(t); updates.push(`title = $${params.length}`)
  }
  if (body.description !== undefined) {
    params.push(String(body.description)); updates.push(`description = $${params.length}`)
  }
  if (body.tags !== undefined) {
    params.push(JSON.stringify(Array.isArray(body.tags) ? body.tags.map(String).slice(0, 10) : []))
    updates.push(`tags = $${params.length}`)
  }
  if (body.category !== undefined) {
    params.push(body.category); updates.push(`category = $${params.length}`)
  }
  if (body.custom_fields !== undefined) {
    params.push(JSON.stringify(body.custom_fields)); updates.push(`custom_fields = $${params.length}`)
  }

  if (updates.length === 0) return NextResponse.json({ error: 'no_updates' }, { status: 400 })

  params.push(now); updates.push(`updated_at = $${params.length}`)
  params.push(id)

  const res = await pool.query(
    `UPDATE aaelink.tickets SET ${updates.join(', ')} WHERE id = $${params.length}
     RETURNING id, title, description, status, priority, category, assignee_id AS "assigneeId",
               tags, custom_fields AS "customFields",
               sla_due_at AS "slaDueAt", closed_at AS "closedAt",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    params
  )
  if (res.rowCount === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Activity log
  for (const c of changes) {
    await pool.query(
      `INSERT INTO aaelink.ticket_activity_log (id, ticket_id, actor_id, action, field_name, old_value, new_value, created_at)
       VALUES ($1, $2, $3, 'field_changed', $4, $5, $6, $7)`,
      [randomUUID(), id, uid, c.field, c.old, c.new_val, now]
    )
  }

  // Emit notifications for assignment and status changes
  const uLabelRow = await pool.query<{ username: string; first_name: string; last_name: string }>(
    `SELECT username, first_name, last_name FROM aaelink.users WHERE id = $1`, [uid]
  )
  const changer = uLabelRow.rows[0]
  const changerLabel = changer
    ? `${changer.first_name || ''} ${changer.last_name || ''}`.trim() || changer.username
    : uid.slice(0, 8)

  for (const c of changes) {
    if (c.field === 'assignee_id' && c.new_val && c.new_val !== uid) {
      void notifyTicketAssignment({
        pool, workspaceId: t0.workspace_id!, ticketId: id,
        ticketTitle: t0.title, assigneeId: c.new_val,
        assignedByLabel: changerLabel
      })
    }
    if (c.field === 'status' && t0.created_by && t0.created_by !== uid) {
      void notifyTicketStatusChange({
        pool, workspaceId: t0.workspace_id!, ticketId: id,
        ticketTitle: t0.title, createdBy: t0.created_by,
        changedById: uid, changedByLabel: changerLabel,
        oldStatus: c.old, newStatus: c.new_val
      })
    }
  }

  const t = res.rows[0] as {
    id: string; title: string; description: string; status: string; priority: string;
    category: string; assigneeId: string | null; tags: string; customFields: string;
    slaDueAt: number; closedAt: number; createdAt: number; updatedAt: number;
  }
  return NextResponse.json({
    ticket: { ...t, createdAt: Number(t.createdAt), updatedAt: Number(t.updatedAt), slaDueAt: Number(t.slaDueAt), closedAt: Number(t.closedAt) }
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/tickets/:id', _GET)
export const POST   = tracedRoute('POST', '/api/tickets/:id', _POST)
export const PATCH  = tracedRoute('PATCH', '/api/tickets/:id', _PATCH)
