import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { tracedRoute } from '@/lib/api/tracedRoute'
import {
  listDiscoverableWorkspaces,
  joinOpenWorkspace,
} from '@/lib/workspace/workspaceDiscovery'

/**
 * D1 — Workspace discovery within the org.
 *
 * GET  /api/workspaces/discover — open workspaces in the user's org(s)
 *      they have not joined.
 * POST /api/workspaces/discover — self-join an open workspace
 *      ({ workspace_id }).
 */
async function _GET() {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()

  const workspaces = await listDiscoverableWorkspaces(pool, uid)
  return NextResponse.json({ workspaces })
}

const JOIN_ERROR_STATUS: Record<string, number> = {
  not_found: 404,
  not_open: 409,
  already_member: 409,
  not_in_org: 403,
}

async function _POST(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf

  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await ensureSchema()

  const body = (await req.json().catch(() => ({}))) as { workspace_id?: string }
  const workspaceId = String(body.workspace_id || '').trim()
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })

  const result = await joinOpenWorkspace(pool, uid, workspaceId)
  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: JOIN_ERROR_STATUS[result.code] ?? 400 })
  }

  writeAuditLog({
    pool,
    workspaceId: result.workspaceId,
    actorId: uid,
    action: 'workspace.member.add',
    resourceKind: 'workspace',
    resourceId: result.workspaceId,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
    metadata: { via: 'discovery_self_join', channelId: result.channelId },
  })

  return NextResponse.json({ ok: true, workspace_id: result.workspaceId, channel_id: result.channelId })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET  = tracedRoute('GET', '/api/workspaces/discover', _GET)
export const POST = tracedRoute('POST', '/api/workspaces/discover', _POST)
