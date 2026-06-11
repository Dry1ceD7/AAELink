import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { tracedRoute } from '@/lib/api/tracedRoute'
import {
  getOrganization,
  updateOrganization,
  deleteOrganization,
} from '@/lib/enterprise/orgAdmin'

/**
 * GET    /api/admin/org/[orgId] — get single org
 * PATCH  /api/admin/org/[orgId] — update org
 * DELETE /api/admin/org/[orgId] — delete org
 */

type Ctx = { params: Promise<{ orgId: string }> }

async function requireAdmin(): Promise<{ uid: string; pool: NonNullable<ReturnType<typeof getPool>> } | Response> {
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
  return { uid, pool }
}

async function _GET(_req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const { orgId } = await ctx.params
  const org = await getOrganization(orgId)
  if (!org) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ organization: org })
}

async function _PATCH(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const { orgId } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const org = await updateOrganization(orgId, body)
  if (!org) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ organization: org })
}

async function _DELETE(_req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const { orgId } = await ctx.params
  const ok = await deleteOrganization(orgId)
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ deleted: true })
}

export const GET    = tracedRoute('GET',    '/api/admin/org/[orgId]', _GET)
export const PATCH  = tracedRoute('PATCH',  '/api/admin/org/[orgId]', _PATCH)
export const DELETE = tracedRoute('DELETE', '/api/admin/org/[orgId]', _DELETE)
