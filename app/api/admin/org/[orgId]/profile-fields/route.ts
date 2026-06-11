import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { verifyCsrf } from '@/lib/auth/csrf'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { writeAuditLog, extractIp } from '@/lib/enterprise/auditLog'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { defineField, removeField, listFields } from '@/lib/enterprise/customProfileFields'

/**
 * Org custom profile field definitions (D11).
 *
 * GET    /api/admin/org/[orgId]/profile-fields — list field definitions
 * POST   /api/admin/org/[orgId]/profile-fields — define/update a field
 *        Body: { key, label, type?, options?, position? }
 * DELETE /api/admin/org/[orgId]/profile-fields — remove a field  Body: { field_id }
 */
type Ctx = { params: Promise<{ orgId: string }> }
const ERR: Record<string, number> = { invalid_key: 400, invalid_type: 400, invalid_label: 400, duplicate_key: 409 }

async function requireAdmin(): Promise<string | NextResponse> {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { rows } = await pool.query(`SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid])
  if (!isPlatformAdmin((rows[0] as { platform_role?: string })?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  return uid
}

async function _GET(_req: NextRequest, ctx: Ctx) {
  const guard = await requireAdmin()
  if (guard instanceof NextResponse) return guard
  const { orgId } = await ctx.params
  const fields = await listFields(getPool()!, orgId)
  return NextResponse.json({ fields, total: fields.length })
}

async function _POST(req: NextRequest, ctx: Ctx) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  const guard = await requireAdmin()
  if (guard instanceof NextResponse) return guard
  const uid = guard
  const pool = getPool()!
  const { orgId } = await ctx.params

  const body = (await req.json().catch(() => ({}))) as { key?: string; label?: string; type?: string; options?: string[]; position?: number }
  const result = await defineField(pool, orgId, {
    key: String(body.key || ''), label: String(body.label || ''),
    type: body.type, options: body.options, position: body.position,
  })
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: ERR[result.code] ?? 400 })

  writeAuditLog({
    pool, actorId: uid, action: 'org.profile_field.define', resourceKind: 'organization', resourceId: orgId,
    ipAddress: extractIp(req), userAgent: req.headers.get('user-agent') || '', metadata: { field_key: result.field.field_key },
  })
  return NextResponse.json({ ok: true, field: result.field }, { status: 201 })
}

async function _DELETE(req: NextRequest, ctx: Ctx) {
  const csrf = await verifyCsrf(req)
  if (csrf) return csrf
  const guard = await requireAdmin()
  if (guard instanceof NextResponse) return guard
  const uid = guard
  const pool = getPool()!
  const { orgId } = await ctx.params

  const body = (await req.json().catch(() => ({}))) as { field_id?: string }
  const fieldId = String(body.field_id || '').trim()
  if (!fieldId) return NextResponse.json({ error: 'field_id_required' }, { status: 400 })

  const removed = await removeField(pool, orgId, fieldId)
  if (!removed) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  writeAuditLog({
    pool, actorId: uid, action: 'org.profile_field.remove', resourceKind: 'organization', resourceId: orgId,
    ipAddress: extractIp(req), userAgent: req.headers.get('user-agent') || '', metadata: { field_id: fieldId },
  })
  return NextResponse.json({ ok: true, removed: true })
}

export const GET    = tracedRoute('GET', '/api/admin/org/[orgId]/profile-fields', _GET)
export const POST   = tracedRoute('POST', '/api/admin/org/[orgId]/profile-fields', _POST)
export const DELETE = tracedRoute('DELETE', '/api/admin/org/[orgId]/profile-fields', _DELETE)
