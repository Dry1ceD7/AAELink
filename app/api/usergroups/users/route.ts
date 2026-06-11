import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Usergroups Users API — Slack usergroups.users parity.
 *
 * GET  /api/usergroups/users?usergroup_id=... — list members of a user group
 * POST /api/usergroups/users — add/remove members
 *   Actions: update (replace all), add, remove
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const groupId = req.nextUrl.searchParams.get('usergroup_id') || ''
  if (!groupId) return NextResponse.json({ error: 'usergroup_id_required' }, { status: 400 })

  const includeDisabled = req.nextUrl.searchParams.get('include_disabled') === 'true'

  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.display_name, u.email, u.avatar_url, u.status_text, u.status_emoji
     FROM aaelink.user_group_members ugm
     JOIN aaelink.users u ON u.id = ugm.user_id
     WHERE ugm.group_id = $1
       ${includeDisabled ? '' : "AND COALESCE(u.deactivated_at, 0) = 0"}
     ORDER BY u.display_name ASC, u.username ASC`,
    [groupId]
  )

  return NextResponse.json({ users: rows.map(r => r.id), members: rows })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    action?: string
    usergroup_id?: string
    user_ids?: string[]
  }

  if (!body.usergroup_id) return NextResponse.json({ error: 'usergroup_id_required' }, { status: 400 })
  const userIds = body.user_ids || []
  const now = Date.now()

  if (body.action === 'update' || !body.action) {
    // Replace all members
    await pool.query(`DELETE FROM aaelink.user_group_members WHERE group_id = $1`, [body.usergroup_id])
    for (const userId of userIds) {
      await pool.query(
        `INSERT INTO aaelink.user_group_members (group_id, user_id, added_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [body.usergroup_id, userId, now]
      )
    }
    return NextResponse.json({ ok: true, users: userIds })
  }

  if (body.action === 'add') {
    let added = 0
    for (const userId of userIds) {
      const res = await pool.query(
        `INSERT INTO aaelink.user_group_members (group_id, user_id, added_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [body.usergroup_id, userId, now]
      )
      if ((res.rowCount ?? 0) > 0) added++
    }
    return NextResponse.json({ ok: true, added })
  }

  if (body.action === 'remove') {
    if (userIds.length > 0) {
      await pool.query(
        `DELETE FROM aaelink.user_group_members WHERE group_id = $1 AND user_id = ANY($2)`,
        [body.usergroup_id, userIds]
      )
    }
    return NextResponse.json({ ok: true, removed: userIds.length })
  }

  return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
}

export const GET  = tracedRoute('GET',  '/api/usergroups/users', _GET)
export const POST = tracedRoute('POST', '/api/usergroups/users', _POST)
