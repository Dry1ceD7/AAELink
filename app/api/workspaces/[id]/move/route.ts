import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { moveWorkspaceToOrg } from '@/lib/workspace/workspaceLifecycle'

const MOVE_ERROR_STATUS: Record<string, number> = {
  not_found: 404,
  forbidden: 403,
  system_workspace: 403,
  org_not_found: 404,
  not_in_org: 403,
}

/** POST /api/workspaces/:id/move — owner reassigns the workspace's org (D1). */
async function _POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf

  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()
  const { id: workspaceId } = await ctx.params

  const body = (await req.json().catch(() => ({}))) as { org_id?: string | null }
  // `org_id: null` detaches the workspace; a string assigns it. A missing key is
  // rejected so a no-body call cannot silently detach a workspace from its org.
  if (!('org_id' in body)) return NextResponse.json({ error: 'org_id_required' }, { status: 400 })
  const targetOrgId = body.org_id === null ? null : String(body.org_id ?? '').trim()
  if (targetOrgId === '') return NextResponse.json({ error: 'org_id_required' }, { status: 400 })

  const result = await moveWorkspaceToOrg(pool, uid, workspaceId, targetOrgId)
  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: MOVE_ERROR_STATUS[result.code] ?? 400 })
  }

  writeAuditLog({
    pool,
    workspaceId: result.workspaceId,
    actorId: uid,
    action: 'workspace.move',
    resourceKind: 'workspace',
    resourceId: result.workspaceId,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
    metadata: { org_id: result.orgId },
  })

  return NextResponse.json({ ok: true, workspace_id: result.workspaceId, org_id: result.orgId })
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST = tracedRoute('POST', '/api/workspaces/:id/move', _POST)
