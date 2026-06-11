import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { listOrgWorkspaces, addWorkspaceToOrg } from '@/lib/enterprise/orgAdmin'

/**
 * GET  /api/admin/org/[orgId]/workspaces — list workspaces in org
 * POST /api/admin/org/[orgId]/workspaces — add workspace to org
 */

type Ctx = { params: Promise<{ orgId: string }> }

async function _GET(_req: NextRequest, ctx: Ctx) {
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

  const { orgId } = await ctx.params
  const workspaces = await listOrgWorkspaces(orgId)
  return NextResponse.json({ workspaces })
}

async function _POST(req: NextRequest, ctx: Ctx) {
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

  const { orgId } = await ctx.params
  const body = await req.json().catch(() => ({})) as { workspace_id?: string }
  if (!body.workspace_id) {
    return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })
  }

  const ok = await addWorkspaceToOrg(orgId, body.workspace_id)
  if (!ok) return NextResponse.json({ error: 'update_failed' }, { status: 404 })
  return NextResponse.json({ added: true })
}

export const GET  = tracedRoute('GET',  '/api/admin/org/[orgId]/workspaces', _GET)
export const POST = tracedRoute('POST', '/api/admin/org/[orgId]/workspaces', _POST)
