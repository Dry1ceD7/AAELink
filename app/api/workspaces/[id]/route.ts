import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { setWorkspaceAccessLevel } from '@/lib/workspace/workspaceDiscovery'

async function _DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()
  const { id: workspaceId } = await ctx.params
  const { rows } = await pool.query<{ is_system: boolean; role: string }>(
    `SELECT w.is_system, m.role
     FROM aaelink.workspaces w
     INNER JOIN aaelink.workspace_members m ON m.workspace_id = w.id AND m.user_id = $1
     WHERE w.id = $2`,
    [uid, workspaceId]
  )
  const row = rows[0]
  if (!row) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (row.is_system) {
    return NextResponse.json({ error: 'system_workspace_cannot_delete' }, { status: 403 })
  }
  if (row.role !== 'owner') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  await pool.query(`DELETE FROM aaelink.workspaces WHERE id = $1`, [workspaceId])
  return NextResponse.json({ ok: true })
}

const ACCESS_ERROR_STATUS: Record<string, number> = {
  not_found: 404,
  forbidden: 403,
  invalid_level: 400,
}

/** PATCH /api/workspaces/:id — owner updates workspace access level (D1). */
async function _PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf

  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()
  const { id: workspaceId } = await ctx.params

  const body = (await req.json().catch(() => ({}))) as { access_level?: string }
  const level = String(body.access_level || '').trim()
  if (!level) return NextResponse.json({ error: 'access_level_required' }, { status: 400 })

  const result = await setWorkspaceAccessLevel(pool, uid, workspaceId, level)
  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: ACCESS_ERROR_STATUS[result.code] ?? 400 })
  }

  writeAuditLog({
    pool,
    workspaceId: result.workspaceId,
    actorId: uid,
    action: 'workspace.access_level.update',
    resourceKind: 'workspace',
    resourceId: result.workspaceId,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
    metadata: { access_level: result.accessLevel },
  })

  return NextResponse.json({ ok: true, workspace_id: result.workspaceId, access_level: result.accessLevel })
}

// ── Traced exports ──────────────────────────────────────────────────
export const DELETE = tracedRoute('DELETE', '/api/workspaces/:id', _DELETE)
export const PATCH  = tracedRoute('PATCH', '/api/workspaces/:id', _PATCH)
