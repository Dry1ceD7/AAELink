import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { isWorkspaceMember } from '@/lib/workspaceAccess'
import { getMemberDepartmentId, userIsItForWorkspace } from '@/lib/ticketAccess'

type Status = 'open' | 'in_progress' | 'resolved'
type Priority = 'low' | 'medium' | 'urgent'

function isStatus(v: string): v is Status {
  return v === 'open' || v === 'in_progress' || v === 'resolved'
}

function isPriority(v: string): v is Priority {
  return v === 'low' || v === 'medium' || v === 'urgent'
}

export async function GET(req: Request) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()
  const workspaceId = new URL(req.url).searchParams.get('workspace_id')?.trim()
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  }
  if (!(await isWorkspaceMember(pool, uid, workspaceId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const isIt = await userIsItForWorkspace(pool, uid, workspaceId)
  const userDept = await getMemberDepartmentId(pool, uid, workspaceId)
  const params: unknown[] = [workspaceId]
  let where = `t.workspace_id = $1`
  if (!isIt) {
    if (userDept) {
      where += ` AND (t.department_id = $2 OR t.created_by = $3)`
      params.push(userDept, uid)
    } else {
      where += ` AND t.created_by = $2`
      params.push(uid)
    }
  }
  const { rows } = await pool.query(
    `SELECT t.id, t.title, t.description, t.status, t.priority, t.created_by AS "createdBy",
            t.department_id AS "departmentId", d.code AS "departmentCode", d.name AS "departmentName",
            t.assignee_id AS "assigneeId", t.tags,
            t.created_at AS "createdAt", t.updated_at AS "updatedAt"
     FROM aaelink.tickets t
     LEFT JOIN aaelink.departments d ON d.id = t.department_id
     WHERE ${where} ORDER BY t.updated_at DESC, t.created_at DESC`,
    params
  )
  const tickets = rows.map(r => {
    const row = r as Record<string, unknown>
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      createdBy: row.createdBy,
      departmentId: row.departmentId,
      departmentCode: row.departmentCode,
      departmentName: row.departmentName,
      assigneeId: row.assigneeId,
      tags: row.tags,
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt)
    }
  })
  return NextResponse.json({ tickets, meta: { viewer_is_it: isIt } })
}

export async function POST(req: Request) {
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
    tags?: string[]
  }
  const workspaceId = String(body.workspace_id || '').trim()
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  if (!(await isWorkspaceMember(pool, uid, workspaceId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const title = String(body.title || '').trim()
  if (!title) return NextResponse.json({ error: 'title_required' }, { status: 400 })
  const description = String(body.description || '').trim()
  const priority = body.priority && isPriority(body.priority) ? body.priority : 'medium'
  const tags = Array.isArray(body.tags) ? body.tags.map(String).slice(0, 5) : []
  const now = Date.now()
  const id = `T-${now}-${Math.random().toString(36).slice(2, 8)}`
  const deptId = await getMemberDepartmentId(pool, uid, workspaceId)
  await pool.query(
    `INSERT INTO aaelink.tickets (id, workspace_id, title, description, status, priority, created_at, updated_at, created_by, department_id, tags)
     VALUES ($1, $2, $3, $4, 'open', $5, $6, $6, $7, $8, $9)`,
    [id, workspaceId, title, description, priority, now, uid, deptId, JSON.stringify(tags)]
  )
  return NextResponse.json({
    ticket: {
      id,
      workspace_id: workspaceId,
      title,
      description,
      status: 'open' as const,
      priority,
      createdBy: uid,
      departmentId: deptId,
      tags,
      createdAt: now,
      updatedAt: now
    }
  })
}
