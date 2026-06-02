import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { assignRole, removeAssignment, listAssignments } from '@/lib/auth/customRoles'

/**
 * Admin role assignments management.
 *
 * GET    — list role assignments
 * POST   — assign a role to a user
 * DELETE — remove an assignment
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

  const userId = req.nextUrl.searchParams.get('user_id') || undefined
  const roleId = req.nextUrl.searchParams.get('role_id') || undefined

  const assignments = await listAssignments(auth.pool, workspaceId, { userId, roleId })
  return NextResponse.json({ assignments })
}

async function _POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const body = await req.json().catch(() => ({})) as {
    role_id?: string; user_id?: string; workspace_id?: string
    scope?: string; scope_id?: string
  }
  if (!body.role_id || !body.user_id || !body.workspace_id) {
    return NextResponse.json({ error: 'role_id_user_id_workspace_id_required' }, { status: 400 })
  }

  const assignment = await assignRole(
    auth.pool, body.role_id, body.user_id, body.workspace_id,
    body.scope || 'workspace', body.scope_id || '', auth.uid
  )
  return NextResponse.json({ assignment }, { status: 201 })
}

async function _DELETE(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const body = await req.json().catch(() => ({})) as { assignment_id?: string }
  if (!body.assignment_id) return NextResponse.json({ error: 'assignment_id_required' }, { status: 400 })

  await removeAssignment(auth.pool, body.assignment_id)
  return NextResponse.json({ deleted: true })
}

export const GET    = tracedRoute('GET',    '/api/admin/roles/assignments', _GET)
export const POST   = tracedRoute('POST',   '/api/admin/roles/assignments', _POST)
export const DELETE = tracedRoute('DELETE', '/api/admin/roles/assignments', _DELETE)
