import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { createRole, updateRole, deleteRole, listRoles } from '@/lib/auth/customRoles'

/**
 * Admin custom roles management.
 *
 * GET    — list roles for a workspace
 * POST   — create a new role
 * PATCH  — update a role
 * DELETE — delete a role
 */

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
  return { uid, pool }
}

async function _GET(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const workspaceId = req.nextUrl.searchParams.get('workspace_id') || ''
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id_required' }, { status: 400 })

  const roles = await listRoles(auth.pool, workspaceId)
  return NextResponse.json({ roles })
}

async function _POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const body = await req.json().catch(() => ({})) as {
    workspace_id?: string; name?: string; description?: string; permissions?: string[]
  }
  if (!body.workspace_id || !body.name) {
    return NextResponse.json({ error: 'workspace_id_and_name_required' }, { status: 400 })
  }

  const role = await createRole(auth.pool, body.workspace_id, body.name, body.description || '', body.permissions || [])
  return NextResponse.json({ role }, { status: 201 })
}

async function _PATCH(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const body = await req.json().catch(() => ({})) as {
    role_id?: string; name?: string; description?: string; permissions?: string[]
  }
  if (!body.role_id) return NextResponse.json({ error: 'role_id_required' }, { status: 400 })

  await updateRole(auth.pool, body.role_id, {
    name: body.name, description: body.description, permissions: body.permissions,
  })
  return NextResponse.json({ ok: true })
}

async function _DELETE(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const body = await req.json().catch(() => ({})) as { role_id?: string }
  if (!body.role_id) return NextResponse.json({ error: 'role_id_required' }, { status: 400 })

  const deleted = await deleteRole(auth.pool, body.role_id)
  if (!deleted) return NextResponse.json({ error: 'cannot_delete_system_role' }, { status: 400 })
  return NextResponse.json({ deleted: true })
}

export const GET    = tracedRoute('GET',    '/api/admin/roles', _GET)
export const POST   = tracedRoute('POST',   '/api/admin/roles', _POST)
export const PATCH  = tracedRoute('PATCH',  '/api/admin/roles', _PATCH)
export const DELETE = tracedRoute('DELETE', '/api/admin/roles', _DELETE)
