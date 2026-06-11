import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { ingestManifest, type AppManifest } from '@/lib/apps/appManifest'

/**
 * POST /api/apps/manifest (D7) — create an app (and optional bot) from a
 * manifest. Body: { workspace_id, manifest }. Workspace owner/admin only.
 */
async function _POST(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'database_not_configured' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { workspace_id?: string; manifest?: AppManifest }
  const workspaceId = String(body.workspace_id || '').trim()
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  if (!body.manifest) return NextResponse.json({ error: 'manifest_required' }, { status: 400 })

  // Installing an app is privileged: workspace owner/admin only.
  const { rows } = await pool.query<{ role: string }>(
    `SELECT role FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, uid]
  )
  const role = rows[0]?.role
  if (role !== 'owner' && role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const result = await ingestManifest(pool, { workspaceId, createdBy: uid, manifest: body.manifest })
  if (!result.ok) {
    return NextResponse.json({ error: result.code, detail: result.detail }, { status: 400 })
  }

  writeAuditLog({
    pool,
    actorId: uid,
    action: 'app.manifest.install',
    resourceKind: 'app',
    resourceId: result.app.app_id,
    ipAddress: extractIp(req),
    userAgent: req.headers.get('user-agent') || '',
    metadata: { workspace_id: workspaceId, bot_id: result.app.bot_id, scopes: result.app.scopes },
  })

  return NextResponse.json({ ok: true, app: result.app }, { status: 201 })
}

export const POST = tracedRoute('POST', '/api/apps/manifest', _POST)
