import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { archiveWorkspace, unarchiveWorkspace } from '@/lib/workspace/workspaceLifecycle'

const ARCHIVE_ERROR_STATUS: Record<string, number> = {
  not_found: 404,
  forbidden: 403,
  system_workspace: 403,
  already_archived: 409,
  not_archived: 409,
}

/** POST /api/workspaces/:id/archive — owner archives a workspace (D1). */
async function _POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf

  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()
  const { id: workspaceId } = await ctx.params

  const result = await archiveWorkspace(pool, uid, workspaceId)
  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: ARCHIVE_ERROR_STATUS[result.code] ?? 400 })
  }

  writeAuditLog({
    pool,
    workspaceId: result.workspaceId,
    actorId: uid,
    action: 'workspace.archive',
    resourceKind: 'workspace',
    resourceId: result.workspaceId,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
    metadata: { archived_at: result.archivedAt },
  })

  return NextResponse.json({ ok: true, workspace_id: result.workspaceId, archived_at: result.archivedAt })
}

/** DELETE /api/workspaces/:id/archive — owner unarchives (restores) a workspace (D1). */
async function _DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf

  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()
  const { id: workspaceId } = await ctx.params

  const result = await unarchiveWorkspace(pool, uid, workspaceId)
  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: ARCHIVE_ERROR_STATUS[result.code] ?? 400 })
  }

  writeAuditLog({
    pool,
    workspaceId: result.workspaceId,
    actorId: uid,
    action: 'workspace.unarchive',
    resourceKind: 'workspace',
    resourceId: result.workspaceId,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
  })

  return NextResponse.json({ ok: true, workspace_id: result.workspaceId })
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/workspaces/:id/archive', _POST)
export const DELETE = tracedRoute('DELETE', '/api/workspaces/:id/archive', _DELETE)
