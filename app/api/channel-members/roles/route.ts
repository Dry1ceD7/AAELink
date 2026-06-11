// keep: slack-compat surface (intentionally addressable, may be invoked by Slack-shaped clients)
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/comms/platformRole'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Channel Member Roles API — per-channel admin management (Slack parity).
 *
 * GET    /api/channel-members/roles?channel_id=...
 * PATCH  /api/channel-members/roles { channel_id, user_id, role }
 *
 * Roles: 'admin' (can moderate, invite, pin, rename), 'member' (standard).
 * Platform admins can always change roles. Channel admins can promote/demote.
 */

/** GET — list channel members with their per-channel roles */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const channelId = req.nextUrl.searchParams.get('channel_id')?.trim() || ''
  if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })

  // Must be a member
  const { rows: selfMember } = await pool.query<{ role: string }>(
    `SELECT role FROM aaelink.channel_members WHERE channel_id = $1 AND user_id = $2`,
    [channelId, uid]
  )
  if (!selfMember[0]) return NextResponse.json({ error: 'not_a_member' }, { status: 403 })

  const { rows } = await pool.query(`
    SELECT cm.user_id, cm.role, cm.joined_at,
           u.username, u.first_name, u.last_name, u.avatar_url,
           u.status_text, u.status_emoji,
           COALESCE(u.last_seen_at, 0) AS last_seen_at,
           COALESCE(u.deactivated_at, 0) AS deactivated_at
    FROM aaelink.channel_members cm
    JOIN aaelink.users u ON u.id = cm.user_id
    WHERE cm.channel_id = $1
    ORDER BY cm.role DESC, u.username ASC
  `, [channelId])

  return NextResponse.json({
    members: rows.map(r => ({
      ...r,
      is_admin: r.role === 'admin',
      is_online: Date.now() - Number(r.last_seen_at) < 120_000
    })),
    total: rows.length,
    your_role: selfMember[0].role
  })
}

/** PATCH — change a member's per-channel role */
async function _PATCH(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    channel_id?: string
    user_id?: string
    role?: string
  }

  const channelId = String(body.channel_id || '').trim()
  const targetUserId = String(body.user_id || '').trim()
  const newRole = String(body.role || '').trim()

  if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })
  if (!targetUserId) return NextResponse.json({ error: 'user_id_required' }, { status: 400 })
  if (!['admin', 'member'].includes(newRole)) {
    return NextResponse.json({ error: 'invalid_role' }, { status: 400 })
  }

  // Check caller authorization
  const { rows: callerMember } = await pool.query<{ role: string }>(
    `SELECT role FROM aaelink.channel_members WHERE channel_id = $1 AND user_id = $2`,
    [channelId, uid]
  )
  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  const callerIsChannelAdmin = callerMember[0]?.role === 'admin'
  const callerIsPlatformAdmin = isPlatformAdmin(uRows[0]?.platform_role)

  if (!callerIsChannelAdmin && !callerIsPlatformAdmin) {
    return NextResponse.json({ error: 'admin_required' }, { status: 403 })
  }

  // Prevent self-demotion (last admin check)
  if (targetUserId === uid && newRole === 'member') {
    const { rows: adminCount } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM aaelink.channel_members WHERE channel_id = $1 AND role = 'admin'`,
      [channelId]
    )
    if (Number(adminCount[0]?.count || 0) <= 1) {
      return NextResponse.json({ error: 'cannot_remove_last_admin' }, { status: 400 })
    }
  }

  // Verify target is a member
  const { rows: targetMember } = await pool.query<{ role: string }>(
    `SELECT role FROM aaelink.channel_members WHERE channel_id = $1 AND user_id = $2`,
    [channelId, targetUserId]
  )
  if (!targetMember[0]) return NextResponse.json({ error: 'user_not_in_channel' }, { status: 404 })

  // Update role
  await pool.query(
    `UPDATE aaelink.channel_members SET role = $1 WHERE channel_id = $2 AND user_id = $3`,
    [newRole, channelId, targetUserId]
  )

  return NextResponse.json({
    ok: true,
    channel_id: channelId,
    user_id: targetUserId,
    old_role: targetMember[0].role,
    new_role: newRole
  })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/channel-members/roles', _GET)
export const PATCH  = tracedRoute('PATCH', '/api/channel-members/roles', _PATCH)
