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
import { DEFAULT_BUSINESS_HOURS, type BusinessHoursWindow } from '@/lib/enterprise/slaEngine'

interface BhRow {
  id: string
  workspace_id: string
  name: string
  timezone: string
  schedule: BusinessHoursWindow[] | string
  holidays: string[] | string
  created_at: string
}

function parseSchedule(input: unknown): BusinessHoursWindow[] {
  if (!Array.isArray(input)) return DEFAULT_BUSINESS_HOURS
  const out: BusinessHoursWindow[] = []
  for (const r of input) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const wday = Number(o.wday)
    const start = Number(o.start)
    const end = Number(o.end)
    if (!Number.isInteger(wday) || wday < 1 || wday > 7) continue
    if (!Number.isFinite(start) || start < 0 || start > 1440) continue
    if (!Number.isFinite(end) || end <= start || end > 1440) continue
    out.push({ wday, start, end })
  }
  return out.length ? out : DEFAULT_BUSINESS_HOURS
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

  const { rows } = await pool.query<BhRow>(
    `SELECT id, workspace_id, name, timezone, schedule, holidays, created_at
     FROM aaelink.business_hours WHERE workspace_id = $1 ORDER BY name`,
    [wsId]
  )
  return NextResponse.json({
    business_hours: rows.map(r => ({
      ...r,
      schedule: Array.isArray(r.schedule) ? r.schedule : JSON.parse(String(r.schedule || '[]')),
      holidays: Array.isArray(r.holidays) ? r.holidays : JSON.parse(String(r.holidays || '[]')),
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
    timezone?: string
    schedule?: unknown
    holidays?: string[]
  }

  const wsId = String(body.workspace_id || '').trim()
  if (!wsId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })

  const id = randomUUID()
  const now = Date.now()
  const tz = String(body.timezone || 'UTC').trim() || 'UTC'
  const schedule = parseSchedule(body.schedule)
  const holidays = Array.isArray(body.holidays)
    ? body.holidays.map(String).filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s)).slice(0, 365)
    : []

  await pool.query(
    `INSERT INTO aaelink.business_hours (id, workspace_id, name, timezone, schedule, holidays, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, wsId, String(body.name || 'Default').trim(), tz, JSON.stringify(schedule), JSON.stringify(holidays), now]
  )

  writeAuditLog({
    pool, workspaceId: wsId, actorId: uid,
    action: 'business_hours.create',
    resourceKind: 'business_hours', resourceId: id,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
    metadata: { timezone: tz, windows: schedule.length, holidays: holidays.length },
  })

  return NextResponse.json({ business_hours: { id, workspace_id: wsId, name: body.name || 'Default', timezone: tz, schedule, holidays, created_at: now } })
}

export const GET = tracedRoute('GET', '/api/business-hours', _GET)
export const POST = tracedRoute('POST', '/api/business-hours', _POST)
