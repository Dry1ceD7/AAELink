import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { isWorkspaceMember } from '@/lib/workspaceAccess'
import { canViewTicket, userIsItForWorkspace } from '@/lib/ticketAccess'

type Status = 'open' | 'in_progress' | 'resolved'
type Priority = 'low' | 'medium' | 'urgent'

function isStatus(v: string): v is Status {
  return v === 'open' || v === 'in_progress' || v === 'resolved'
}

function isPriority(v: string): v is Priority {
  return v === 'low' || v === 'medium' || v === 'urgent'
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()
  const { id } = await ctx.params
  const { rows: tw } = await pool.query<{
    id: string
    workspace_id: string | null
    department_id: string | null
    created_by: string | null
    title: string
    description: string
    status: string
    priority: string
    created_at: string
    updated_at: string
    department_code: string | null
    department_name: string | null
    assignee_id: string | null
    tags: any
  }>(
     `SELECT t.id, t.workspace_id, t.department_id, t.created_by, t.title, t.description, t.status, t.priority,
             t.assignee_id, t.tags,
             t.created_at, t.updated_at, d.code AS department_code, d.name AS department_name
      FROM aaelink.tickets t
      LEFT JOIN aaelink.departments d ON d.id = t.department_id
     WHERE t.id = $1`,
    [id]
  )
  const t = tw[0]
  if (!t || !t.workspace_id) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!(await isWorkspaceMember(pool, uid, t.workspace_id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  if (!(await canViewTicket(pool, uid, t))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const isIt = await userIsItForWorkspace(pool, uid, t.workspace_id)
  const { rows: msgs } = await pool.query(
    `SELECT id, user_id AS "userId", body, created_at AS "createdAt" FROM aaelink.ticket_messages
     WHERE ticket_id = $1 ORDER BY created_at ASC`,
    [id]
  )
  return NextResponse.json({
    ticket: {
      id: t.id,
      workspace_id: t.workspace_id,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      createdBy: t.created_by,
      createdAt: Number(t.created_at),
      updatedAt: Number(t.updated_at),
      departmentCode: t.department_code ?? undefined,
      departmentName: t.department_name ?? undefined,
      assigneeId: t.assignee_id ?? undefined,
      tags: t.tags ?? undefined
    },
    messages: msgs.map(m => {
      const r = m as Record<string, unknown>
      return {
        id: r.id,
        userId: r.userId,
        body: r.body,
        createdAt: Number(r.createdAt)
      }
    }),
    meta: { viewer_is_it: isIt }
  })
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()
  const { id } = await ctx.params
  const { rows: tw } = await pool.query<{
    workspace_id: string | null
    department_id: string | null
    created_by: string | null
  }>(`SELECT workspace_id, department_id, created_by FROM aaelink.tickets WHERE id = $1`, [id])
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
    status?: string
    priority?: string
    title?: string
    description?: string
    tags?: string[]
    assignee_id?: string | null
  }
  if (body.status !== undefined || body.priority !== undefined || body.assignee_id !== undefined) {
    if (!isIt) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  }
  if (body.title !== undefined || body.description !== undefined) {
    const isCreator = t0.created_by === uid
    if (!isIt && !isCreator) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  }
  const now = Date.now()
  const patch: Record<string, unknown> = {}
  if (body.status !== undefined) {
    if (!isStatus(body.status)) return NextResponse.json({ error: 'invalid_status' }, { status: 400 })
    patch.status = body.status
  }
  if (body.priority !== undefined) {
    if (!isPriority(body.priority)) return NextResponse.json({ error: 'invalid_priority' }, { status: 400 })
    patch.priority = body.priority
  }
  if (body.title !== undefined) {
    const t = String(body.title).trim()
    if (!t) return NextResponse.json({ error: 'title_required' }, { status: 400 })
    patch.title = t
  }
  if (body.description !== undefined) {
    patch.description = String(body.description)
  }
  if (body.tags !== undefined) {
    const tagsArray = Array.isArray(body.tags) ? body.tags.map(String).slice(0, 5) : []
    patch.tags = JSON.stringify(tagsArray)
  }
  if (body.assignee_id !== undefined) {
    patch.assignee_id = body.assignee_id
  }
  const keys = Object.keys(patch)
  if (keys.length === 0) return NextResponse.json({ error: 'no_updates' }, { status: 400 })
  const setParts = keys.map((k, idx) => `${k} = $${idx + 1}`)
  const values = [...keys.map(k => patch[k]), now, id]
  const res = await pool.query(
    `UPDATE aaelink.tickets SET ${setParts.join(', ')}, updated_at = $${keys.length + 1}
     WHERE id = $${keys.length + 2}
     RETURNING id, title, description, status, priority, created_by AS "createdBy",
               assignee_id AS "assigneeId", tags,
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    values
  )
  if (res.rowCount === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const t = res.rows[0] as Record<string, unknown>
  return NextResponse.json({
    ticket: {
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      createdBy: t.createdBy,
      assigneeId: t.assigneeId ?? undefined,
      tags: t.tags ?? undefined,
      createdAt: Number(t.createdAt),
      updatedAt: Number(t.updatedAt)
    }
  })
}
