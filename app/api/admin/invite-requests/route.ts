import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { tracedRoute } from '@/lib/api/tracedRoute'
import { listPendingRequests, approveInviteRequest, denyInviteRequest } from '@/lib/enterprise/inviteRequests'

/**
 * Admin invite request management.
 *
 * GET  — list pending invite requests
 * POST — approve or deny a request (action in body)
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

  const requests = await listPendingRequests(auth.pool, workspaceId)
  return NextResponse.json({ requests })
}

async function _POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const body = await req.json().catch(() => ({})) as {
    action?: string; request_id?: string
  }

  if (!body.request_id) return NextResponse.json({ error: 'request_id_required' }, { status: 400 })

  const action = body.action || 'approve'

  if (action === 'approve') {
    await approveInviteRequest(auth.pool, body.request_id, auth.uid)
    return NextResponse.json({ ok: true, approved: true })
  }

  if (action === 'deny') {
    await denyInviteRequest(auth.pool, body.request_id, auth.uid)
    return NextResponse.json({ ok: true, denied: true })
  }

  return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
}

export const GET  = tracedRoute('GET',  '/api/admin/invite-requests', _GET)
export const POST = tracedRoute('POST', '/api/admin/invite-requests', _POST)
