import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { writeAuditLog } from '@/lib/enterprise/auditLog'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Data Retention Policies API — admin-panel CRUD over named retention policies.
 *
 *   GET    /api/admin/retention-policies?workspace_id=… — list policies
 *   POST   /api/admin/retention-policies               — create a policy
 *   PATCH  /api/admin/retention-policies               — update a policy
 *   DELETE /api/admin/retention-policies?policy_id=…    — remove a policy
 *
 * Backs DataRetentionSettings. A policy carries a scope (global / channel / dm),
 * a display name, and separate message- and file-day windows (null = keep
 * forever). Stored in aaelink.retention_policy_rules (migration 057); the engine's
 * fixed-scope aaelink.retention_policy_rules table is left untouched. Platform-admin
 * gated, CSRF on mutations, audited on writes. Legal holds always win at
 * enforcement time.
 */

type Scope = 'global' | 'channel' | 'dm'
const SCOPES: Scope[] = ['global', 'channel', 'dm']

interface PolicyRow {
  id: string
  workspace_id: string | null
  scope: string
  name: string
  message_days: number | null
  file_days: number | null
  channel_id: string | null
  enabled: boolean
}

function toPolicy(r: PolicyRow) {
  return {
    id: r.id,
    workspace_id: r.workspace_id || '',
    scope: r.scope,
    name: r.name || '',
    message_days: r.message_days,
    file_days: r.file_days,
    channel_id: r.channel_id || '',
    is_active: Boolean(r.enabled),
  }
}

// Retention policies are workspace-scoped, but managed by the platform
// super_admin who has cross-workspace authority by design (org admin). We
// deliberately do NOT assert workspace membership here — the isPlatformAdmin
// gate is the correct, intentional authorization for cross-workspace operation.
async function requireAdmin(
  pool: NonNullable<ReturnType<typeof getPool>>, uid: string
): Promise<boolean> {
  const { rows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  return isPlatformAdmin(rows[0]?.platform_role)
}

/** Returns true if the workspace exists. A policy must never attach to a
 *  non-existent workspace, so callers 404 when this is false. */
async function workspaceExists(
  pool: NonNullable<ReturnType<typeof getPool>>, workspaceId: string
): Promise<boolean> {
  const { rows } = await pool.query<{ ok: number }>(
    `SELECT 1 AS ok FROM aaelink.workspaces WHERE id = $1`, [workspaceId]
  )
  return rows.length > 0
}

async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!(await requireAdmin(pool, uid))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const workspaceId = req.nextUrl.searchParams.get('workspace_id')?.trim() || ''
  if (workspaceId && !(await workspaceExists(pool, workspaceId))) {
    return NextResponse.json({ error: 'workspace_not_found' }, { status: 404 })
  }
  const where = workspaceId ? `WHERE workspace_id = $1 AND name <> ''` : `WHERE name <> ''`
  const params = workspaceId ? [workspaceId] : []
  const { rows } = await pool.query<PolicyRow>(
    `SELECT id, workspace_id, scope, name, message_days, file_days, channel_id, enabled
       FROM aaelink.retention_policy_rules
       ${where}
      ORDER BY scope, name`,
    params
  )

  return NextResponse.json({ policies: rows.map(toPolicy) })
}

async function _POST(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!(await requireAdmin(pool, uid))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    workspace_id?: string; scope?: string; name?: string
    message_days?: number | null; file_days?: number | null; channel_id?: string
  }
  const workspaceId = String(body.workspace_id || '').trim()
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  // A policy can't attach to a non-existent workspace.
  if (!(await workspaceExists(pool, workspaceId))) {
    return NextResponse.json({ error: 'workspace_not_found' }, { status: 404 })
  }
  const name = String(body.name || '').trim()
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })
  const scope: Scope = SCOPES.includes(body.scope as Scope) ? (body.scope as Scope) : 'channel'
  const messageDays = body.message_days == null ? null : Math.max(0, Math.trunc(body.message_days))
  const fileDays = body.file_days == null ? null : Math.max(0, Math.trunc(body.file_days))

  const id = randomUUID()
  await pool.query(
    `INSERT INTO aaelink.retention_policy_rules
       (id, workspace_id, scope, name, message_days, file_days, channel_id, enabled, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, now())`,
    [id, workspaceId, scope, name, messageDays, fileDays, String(body.channel_id || '') || null, uid]
  )

  writeAuditLog({
    pool, actorId: uid, workspaceId,
    action: 'retention.policy.create',
    resourceKind: 'retention_policy', resourceId: id,
    metadata: { name, scope, message_days: messageDays, file_days: fileDays },
  })

  return NextResponse.json({
    policy: { id, workspace_id: workspaceId, scope, name, message_days: messageDays, file_days: fileDays, channel_id: String(body.channel_id || ''), is_active: true },
  }, { status: 201 })
}

async function _PATCH(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!(await requireAdmin(pool, uid))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    policy_id?: string; name?: string
    message_days?: number | null; file_days?: number | null; is_active?: boolean
  }
  const policyId = String(body.policy_id || '').trim()
  if (!policyId) return NextResponse.json({ error: 'policy_id_required' }, { status: 400 })

  const updates: string[] = []
  const params: (string | number | boolean | null)[] = []
  if (body.name !== undefined) { params.push(String(body.name).trim()); updates.push(`name = $${params.length}`) }
  if (body.message_days !== undefined) {
    const v = body.message_days == null ? null : Math.max(0, Math.trunc(body.message_days))
    params.push(v); updates.push(`message_days = $${params.length}`)
  }
  if (body.file_days !== undefined) {
    const v = body.file_days == null ? null : Math.max(0, Math.trunc(body.file_days))
    params.push(v); updates.push(`file_days = $${params.length}`)
  }
  if (body.is_active !== undefined) { params.push(Boolean(body.is_active)); updates.push(`enabled = $${params.length}`) }
  if (updates.length === 0) return NextResponse.json({ error: 'no_updates' }, { status: 400 })

  params.push(uid); updates.push(`updated_by = $${params.length}`)
  updates.push(`updated_at = now()`)
  params.push(policyId)
  const { rows: updatedRows } = await pool.query<{ workspace_id: string | null }>(
    `UPDATE aaelink.retention_policy_rules SET ${updates.join(', ')} WHERE id = $${params.length}
       RETURNING workspace_id`,
    params
  )
  if (updatedRows.length === 0) return NextResponse.json({ error: 'policy_not_found' }, { status: 404 })

  writeAuditLog({
    pool, actorId: uid, workspaceId: updatedRows[0].workspace_id ?? undefined,
    action: 'retention.policy.update',
    resourceKind: 'retention_policy', resourceId: policyId,
    metadata: { name: body.name, message_days: body.message_days, file_days: body.file_days, is_active: body.is_active },
  })

  return NextResponse.json({ ok: true, updated: policyId })
}

async function _DELETE(req: NextRequest) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!(await requireAdmin(pool, uid))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const policyId = req.nextUrl.searchParams.get('policy_id')?.trim() || ''
  if (!policyId) return NextResponse.json({ error: 'policy_id_required' }, { status: 400 })

  // Named admin-panel policies only — never delete an engine scope seed row.
  const { rows: deletedRows } = await pool.query<{ workspace_id: string | null }>(
    `DELETE FROM aaelink.retention_policy_rules WHERE id = $1 AND name <> ''
       RETURNING workspace_id`, [policyId]
  )
  if (deletedRows.length === 0) return NextResponse.json({ error: 'policy_not_found' }, { status: 404 })

  writeAuditLog({
    pool, actorId: uid, workspaceId: deletedRows[0].workspace_id ?? undefined,
    action: 'retention.policy.delete',
    resourceKind: 'retention_policy', resourceId: policyId,
    metadata: { policy_id: policyId },
  })

  return NextResponse.json({ ok: true, deleted: policyId })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET',    '/api/admin/retention-policies', _GET)
export const POST   = tracedRoute('POST',   '/api/admin/retention-policies', _POST)
export const PATCH  = tracedRoute('PATCH',  '/api/admin/retention-policies', _PATCH)
export const DELETE = tracedRoute('DELETE', '/api/admin/retention-policies', _DELETE)
