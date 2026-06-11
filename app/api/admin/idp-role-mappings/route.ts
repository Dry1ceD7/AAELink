// keep: enterprise admin surface for IdP/SCIM group → role mappings (Admin 35 / Identity 13)
import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { verifyCsrf } from '@/lib/auth/csrf'
import { isGrantableRole, type TargetKind } from '@/lib/auth/idpRoleMappings'

/**
 * Admin CRUD for IdP/SCIM group → role mappings.
 *   GET    — list mappings
 *   POST   — create mapping
 *   PATCH  — update mapping (by id)
 *   DELETE — delete mapping (?id=)
 *
 * Platform-admin only. super_admin targets are rejected (see idpRoleMappings clamp).
 */

async function requireAdmin(): Promise<{ uid: string } | NextResponse> {
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { rows } = await pool.query(`SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid])
  const role = (rows[0] as { platform_role?: string })?.platform_role || ''
  if (!isPlatformAdmin(role)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  return { uid }
}

function audit(uid: string, action: string, id: string, metadata: Record<string, unknown>): void {
  const pool = getPool()
  if (!pool) return
  pool.query(
    `INSERT INTO aaelink.audit_log (id, actor_id, action, resource_kind, resource_id, metadata, created_at)
     VALUES ($1, $2, $3, 'idp_role_mapping', $4, $5, $6)`,
    [randomUUID(), uid, action, id, JSON.stringify(metadata), Date.now()]
  ).catch(() => {})
}

async function _GET(_req: NextRequest) {
  await ensureSchema()
  const guard = await requireAdmin()
  if (guard instanceof NextResponse) return guard
  const pool = getPool()!
  const { rows } = await pool.query(
    `SELECT id, org_id, workspace_id, group_pattern, target_kind, target_role,
            priority, is_active, created_at, updated_at
       FROM aaelink.idp_group_role_mappings
      ORDER BY priority DESC, created_at ASC`
  )
  return NextResponse.json({ mappings: rows })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  const guard = await requireAdmin()
  if (guard instanceof NextResponse) return guard
  const { uid } = guard
  const pool = getPool()!

  const body = (await req.json().catch(() => ({}))) as {
    org_id?: string | null
    workspace_id?: string | null
    group_pattern?: string
    target_kind?: string
    target_role?: string
    priority?: number
  }

  const groupPattern = (body.group_pattern || '').trim()
  const targetKind = body.target_kind as TargetKind
  const targetRole = (body.target_role || '').trim()

  if (!groupPattern) return NextResponse.json({ error: 'group_pattern_required' }, { status: 400 })
  if (targetKind !== 'platform_role' && targetKind !== 'workspace_role') {
    return NextResponse.json({ error: 'invalid_target_kind' }, { status: 400 })
  }
  // Clamp: a mapping can never grant super_admin (or any non-grantable role).
  if (!isGrantableRole(targetKind, targetRole)) {
    return NextResponse.json({ error: 'role_not_grantable' }, { status: 400 })
  }

  const id = randomUUID()
  const now = Date.now()
  const { rows } = await pool.query(
    `INSERT INTO aaelink.idp_group_role_mappings
       (id, org_id, workspace_id, group_pattern, target_kind, target_role, priority, is_active, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, $9)
     RETURNING *`,
    [id, body.org_id ?? null, body.workspace_id ?? null, groupPattern, targetKind, targetRole, body.priority ?? 0, uid, now]
  )
  audit(uid, 'idp_role_mapping.create', id, { groupPattern, targetKind, targetRole })
  return NextResponse.json({ mapping: rows[0] }, { status: 201 })
}

async function _PATCH(req: NextRequest) {
  await ensureSchema()
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  const guard = await requireAdmin()
  if (guard instanceof NextResponse) return guard
  const { uid } = guard
  const pool = getPool()!

  const body = (await req.json().catch(() => ({}))) as {
    id?: string
    group_pattern?: string
    target_kind?: string
    target_role?: string
    priority?: number
    is_active?: boolean
  }
  if (!body.id) return NextResponse.json({ error: 'id_required' }, { status: 400 })

  // Validate the role/kind clamp when either is being changed.
  if (body.target_kind !== undefined || body.target_role !== undefined) {
    const kind = body.target_kind as TargetKind
    if (kind !== 'platform_role' && kind !== 'workspace_role') {
      return NextResponse.json({ error: 'invalid_target_kind' }, { status: 400 })
    }
    if (!isGrantableRole(kind, (body.target_role || '').trim())) {
      return NextResponse.json({ error: 'role_not_grantable' }, { status: 400 })
    }
  }

  const { rows } = await pool.query(
    `UPDATE aaelink.idp_group_role_mappings SET
       group_pattern = COALESCE($2, group_pattern),
       target_kind   = COALESCE($3, target_kind),
       target_role   = COALESCE($4, target_role),
       priority      = COALESCE($5, priority),
       is_active     = COALESCE($6, is_active),
       updated_at    = $7
     WHERE id = $1
     RETURNING *`,
    [body.id, body.group_pattern ?? null, body.target_kind ?? null, body.target_role ?? null,
     body.priority ?? null, body.is_active ?? null, Date.now()]
  )
  if (!rows[0]) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  audit(uid, 'idp_role_mapping.update', body.id, { fields: Object.keys(body).filter(k => k !== 'id') })
  return NextResponse.json({ mapping: rows[0] })
}

async function _DELETE(req: NextRequest) {
  await ensureSchema()
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  const guard = await requireAdmin()
  if (guard instanceof NextResponse) return guard
  const { uid } = guard
  const pool = getPool()!

  const id = new URL(req.url).searchParams.get('id') || ''
  if (!id) return NextResponse.json({ error: 'id_required' }, { status: 400 })
  const { rowCount } = await pool.query(`DELETE FROM aaelink.idp_group_role_mappings WHERE id = $1`, [id])
  if (!rowCount) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  audit(uid, 'idp_role_mapping.delete', id, {})
  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET',    '/api/admin/idp-role-mappings', _GET)
export const POST   = tracedRoute('POST',   '/api/admin/idp-role-mappings', _POST)
export const PATCH  = tracedRoute('PATCH',  '/api/admin/idp-role-mappings', _PATCH)
export const DELETE = tracedRoute('DELETE', '/api/admin/idp-role-mappings', _DELETE)
