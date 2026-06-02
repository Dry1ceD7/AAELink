import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { tracedRoute } from '@/lib/api/tracedRoute'
import {
  addOrgMember,
  removeOrgMember,
  updateOrgMemberRole,
  listOrgMembers,
  type OrgRole,
} from '@/lib/enterprise/orgMembers'

/**
 * GET    /api/admin/org/[orgId]/members — list org members
 * POST   /api/admin/org/[orgId]/members — add member
 * PATCH  /api/admin/org/[orgId]/members — update role
 * DELETE /api/admin/org/[orgId]/members — remove member
 */

type Ctx = { params: Promise<{ orgId: string }> }

async function requireAdmin() {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })

  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { rows } = await pool.query(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  if (!isPlatformAdmin((rows[0] as { platform_role?: string })?.platform_role || '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  return null
}

async function _GET(req: NextRequest, ctx: Ctx) {
  const fail = await requireAdmin()
  if (fail) return fail

  const { orgId } = await ctx.params
  const url = new URL(req.url)
  const limit  = Math.min(parseInt(url.searchParams.get('limit')  || '50', 10), 200)
  const offset = parseInt(url.searchParams.get('offset') || '0', 10)

  const members = await listOrgMembers(orgId, limit, offset)
  return NextResponse.json({ members })
}

async function _POST(req: NextRequest, ctx: Ctx) {
  const fail = await requireAdmin()
  if (fail) return fail

  const { orgId } = await ctx.params
  const body = await req.json().catch(() => ({})) as {
    user_id?: string; role?: OrgRole
  }
  if (!body.user_id) {
    return NextResponse.json({ error: 'user_id_required' }, { status: 400 })
  }

  const member = await addOrgMember(orgId, body.user_id, body.role)
  if (!member) return NextResponse.json({ error: 'add_failed' }, { status: 500 })
  return NextResponse.json({ member }, { status: 201 })
}

async function _PATCH(req: NextRequest, ctx: Ctx) {
  const fail = await requireAdmin()
  if (fail) return fail

  const { orgId } = await ctx.params
  const body = await req.json().catch(() => ({})) as {
    user_id?: string; role?: OrgRole
  }
  if (!body.user_id || !body.role) {
    return NextResponse.json({ error: 'user_id_and_role_required' }, { status: 400 })
  }

  const member = await updateOrgMemberRole(orgId, body.user_id, body.role)
  if (!member) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ member })
}

async function _DELETE(req: NextRequest, ctx: Ctx) {
  const fail = await requireAdmin()
  if (fail) return fail

  const { orgId } = await ctx.params
  const body = await req.json().catch(() => ({})) as { user_id?: string }
  if (!body.user_id) {
    return NextResponse.json({ error: 'user_id_required' }, { status: 400 })
  }

  const ok = await removeOrgMember(orgId, body.user_id)
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ removed: true })
}

export const GET    = tracedRoute('GET',    '/api/admin/org/[orgId]/members', _GET)
export const POST   = tracedRoute('POST',   '/api/admin/org/[orgId]/members', _POST)
export const PATCH  = tracedRoute('PATCH',  '/api/admin/org/[orgId]/members', _PATCH)
export const DELETE = tracedRoute('DELETE', '/api/admin/org/[orgId]/members', _DELETE)
