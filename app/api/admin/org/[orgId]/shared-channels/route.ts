import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Admin org-wide shared channels management.
 *
 * GET  — list shared channels in an org
 * POST — set teams for a shared channel
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

async function _GET(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const { orgId } = await params
  if (!orgId) return NextResponse.json({ error: 'org_id_required' }, { status: 400 })

  const { rows } = await auth.pool.query(
    `SELECT c.id, c.name, c.display_name, c.type, c.workspace_id,
            c.is_shared, c.created_at
     FROM aaelink.channels c
     WHERE c.org_id = $1 AND c.is_shared = true
     ORDER BY c.name ASC`,
    [orgId]
  )
  return NextResponse.json({ channels: rows })
}

async function _POST(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const auth = await requireAdmin()
  if (auth instanceof Response) return auth

  const { orgId } = await params
  if (!orgId) return NextResponse.json({ error: 'org_id_required' }, { status: 400 })

  const body = await req.json().catch(() => ({})) as {
    channel_id?: string; team_ids?: string[]
  }
  if (!body.channel_id || !Array.isArray(body.team_ids)) {
    return NextResponse.json({ error: 'channel_id_and_team_ids_required' }, { status: 400 })
  }

  // Clear existing team assignments for this channel
  await auth.pool.query(
    `DELETE FROM aaelink.shared_channel_teams WHERE channel_id = $1 AND org_id = $2`,
    [body.channel_id, orgId]
  )

  // Insert new team assignments
  const now = Date.now()
  for (const teamId of body.team_ids) {
    await auth.pool.query(
      `INSERT INTO aaelink.shared_channel_teams (channel_id, org_id, team_id, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [body.channel_id, orgId, teamId, now]
    )
  }

  return NextResponse.json({ ok: true, channel_id: body.channel_id, team_ids: body.team_ids })
}

export const GET  = tracedRoute('GET',  '/api/admin/org/[orgId]/shared-channels', _GET)
export const POST = tracedRoute('POST', '/api/admin/org/[orgId]/shared-channels', _POST)
