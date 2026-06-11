import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isWorkspaceMember } from '@/lib/workspace/workspaceAccess'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { verifyCsrf } from '@/lib/auth/csrf'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { isTicketPriority } from '@/lib/enterprise/slaEngine'

interface SlaPolicyRow {
  id: string
  workspace_id: string
  name: string
  priority: string
  first_response_ms: string
  resolution_ms: string
  pause_on_status: string[] | string
  business_hours_id: string | null
  created_at: string
}

async function _GET(req: NextRequest) {
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()

  const wsId = new URL(req.url).searchParams.get('workspace_id')?.trim()
  if (!wsId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  if (!(await isWorkspaceMember(pool, uid, wsId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { rows } = await pool.query<SlaPolicyRow>(
    `SELECT id, workspace_id, name, priority,
            first_response_ms, resolution_ms,
            pause_on_status, business_hours_id, created_at
     FROM aaelink.sla_policies WHERE workspace_id = $1
     ORDER BY priority, name`,
    [wsId]
  )
  return NextResponse.json({
    policies: rows.map(r => ({
      ...r,
      first_response_ms: Number(r.first_response_ms),
      resolution_ms: Number(r.resolution_ms),
      pause_on_status: Array.isArray(r.pause_on_status) ? r.pause_on_status : JSON.parse(String(r.pause_on_status || '[]')),
      created_at: Number(r.created_at),
    })),
  })
}

async function _POST(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf

  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  await ensureSchema()

  const { rows: roleRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!isPlatformAdmin(roleRows[0]?.platform_role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    workspace_id?: string
    name?: string
    priority?: string
    first_response_ms?: number
    resolution_ms?: number
    pause_on_status?: string[]
    business_hours_id?: string | null
  }

  const wsId = String(body.workspace_id || '').trim()
  if (!wsId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  if (!body.priority || !isTicketPriority(body.priority)) {
    return NextResponse.json({ error: 'invalid_priority' }, { status: 400 })
  }
  const firstResponse = Number(body.first_response_ms)
  const resolution = Number(body.resolution_ms)
  if (!Number.isFinite(firstResponse) || firstResponse <= 0) {
    return NextResponse.json({ error: 'invalid_first_response_ms' }, { status: 400 })
  }
  if (!Number.isFinite(resolution) || resolution <= 0) {
    return NextResponse.json({ error: 'invalid_resolution_ms' }, { status: 400 })
  }

  const id = randomUUID()
  const now = Date.now()
  const pauseOn = Array.isArray(body.pause_on_status) ? body.pause_on_status.map(String).slice(0, 8) : ['pending']

  await pool.query(
    `INSERT INTO aaelink.sla_policies
       (id, workspace_id, name, priority, first_response_ms, resolution_ms, pause_on_status, business_hours_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id, wsId, String(body.name || `${body.priority} policy`).trim(),
      body.priority, firstResponse, resolution,
      JSON.stringify(pauseOn), body.business_hours_id || null, now,
    ]
  )

  writeAuditLog({
    pool, workspaceId: wsId, actorId: uid,
    action: 'sla.policy.create',
    resourceKind: 'sla_policy', resourceId: id,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
    metadata: { priority: body.priority, first_response_ms: firstResponse, resolution_ms: resolution },
  })

  return NextResponse.json({ policy: { id, workspace_id: wsId, priority: body.priority, first_response_ms: firstResponse, resolution_ms: resolution, pause_on_status: pauseOn, business_hours_id: body.business_hours_id || null, created_at: now } })
}

export const GET = tracedRoute('GET', '/api/sla/policies', _GET)
export const POST = tracedRoute('POST', '/api/sla/policies', _POST)
