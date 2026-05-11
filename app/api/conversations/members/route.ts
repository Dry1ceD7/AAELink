import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Conversation Members API — Slack conversations.invite / conversations.kick parity.
 *
 * GET  /api/conversations/members — list members of a conversation
 * POST /api/conversations/members — invite users to a conversation
 * DELETE /api/conversations/members — remove user from a conversation
 *
 * Also covers: conversations.members list, bulk invite, role changes.
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const channelId = req.nextUrl.searchParams.get('channel_id') || ''
  if (!channelId) return NextResponse.json({ error: 'channel_id required' }, { status: 400 })

  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') || 100), 500)
  const cursor = req.nextUrl.searchParams.get('cursor') || ''

  let query = `
    SELECT cm.user_id, cm.role, cm.joined_at,
           u.display_name, u.email, u.avatar_url, u.platform_role, u.status AS account_status,
           COALESCE(us.status_text, '') AS status_text,
           COALESCE(us.status_emoji, '') AS status_emoji
    FROM aaelink.channel_members cm
    JOIN aaelink.users u ON u.id = cm.user_id
    LEFT JOIN aaelink.user_status us ON us.user_id = cm.user_id
    WHERE cm.channel_id = $1
  `
  const params: unknown[] = [channelId]

  if (cursor) {
    params.push(cursor)
    query += ` AND cm.user_id > $${params.length}`
  }

  query += ` ORDER BY u.display_name ASC LIMIT $${params.length + 1}`
  params.push(limit + 1)

  const { rows } = await pool.query(query, params)
  const hasMore = rows.length > limit
  const members = rows.slice(0, limit).map(r => {
    return {
      user_id: r.user_id,
      display_name: r.display_name,
      email: r.email,
      avatar_url: r.avatar_url || '',
      role: r.role,
      platform_role: r.platform_role,
      account_status: r.account_status,
      status_text: r.status_text,
      status_emoji: r.status_emoji,
      joined_at: r.joined_at,
    }
  })

  return NextResponse.json({
    members,
    response_metadata: {
      next_cursor: hasMore ? String(members[members.length - 1]?.user_id || '') : '',
    },
  })
}

async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    channel_id?: string; user_ids?: string[]; role?: string
  }

  const channelId = body.channel_id || ''
  if (!channelId) return NextResponse.json({ error: 'channel_id required' }, { status: 400 })
  if (!body.user_ids?.length) return NextResponse.json({ error: 'user_ids required' }, { status: 400 })

  // Verify inviter is member with admin role (or platform admin)
  const { rows: inviterCheck } = await pool.query<{ role: string }>(
    `SELECT role FROM aaelink.channel_members WHERE channel_id = $1 AND user_id = $2`, [channelId, uid]
  )
  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  const isAdmin = inviterCheck[0]?.role === 'admin' || ['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')
  if (!isAdmin && !inviterCheck[0]) {
    return NextResponse.json({ error: 'not_in_channel' }, { status: 403 })
  }

  const now = Date.now()
  const role = body.role || 'member'
  const added: string[] = []
  const alreadyMember: string[] = []

  for (const userId of body.user_ids.slice(0, 50)) {
    // Verify user exists
    const { rows: userCheck } = await pool.query(`SELECT 1 FROM aaelink.users WHERE id = $1`, [userId])
    if (!userCheck[0]) continue

    const { rows: existing } = await pool.query(
      `SELECT 1 FROM aaelink.channel_members WHERE channel_id = $1 AND user_id = $2`, [channelId, userId]
    )
    if (existing[0]) { alreadyMember.push(userId); continue }

    await pool.query(`
      INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
      VALUES ($1, $2, $3, $4)
    `, [channelId, userId, role, now])

    // System message
    await pool.query(`
      INSERT INTO aaelink.messages (id, channel_id, user_id, content, type, created_at)
      VALUES ($1, $2, $3, $4, 'system', $5)
    `, [randomUUID(), channelId, uid, `added <@${userId}> to the channel`, now])

    added.push(userId)
  }

  return NextResponse.json({ ok: true, added, already_member: alreadyMember })
}

async function _DELETE(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { channel_id?: string; user_id?: string }
  const channelId = body.channel_id || ''
  const targetId = body.user_id || ''

  if (!channelId || !targetId) {
    return NextResponse.json({ error: 'channel_id and user_id required' }, { status: 400 })
  }

  // Permission check — must be channel admin or platform admin
  const { rows: inviterCheck } = await pool.query<{ role: string }>(
    `SELECT role FROM aaelink.channel_members WHERE channel_id = $1 AND user_id = $2`, [channelId, uid]
  )
  const { rows: uRows } = await pool.query<{ platform_role: string }>(
    `SELECT platform_role FROM aaelink.users WHERE id = $1`, [uid]
  )
  const isAdmin = inviterCheck[0]?.role === 'admin' || ['super_admin', 'platform_admin'].includes(uRows[0]?.platform_role || '')
  if (!isAdmin) return NextResponse.json({ error: 'not_authorized' }, { status: 403 })

  // Can't remove from default channel
  const { rows: chCheck } = await pool.query<{ is_default: boolean }>(
    `SELECT COALESCE(is_default, false) AS is_default FROM aaelink.channels WHERE id = $1`, [channelId]
  )
  if (chCheck[0]?.is_default) {
    return NextResponse.json({ error: 'cant_kick_from_general' }, { status: 400 })
  }

  await pool.query(
    `DELETE FROM aaelink.channel_members WHERE channel_id = $1 AND user_id = $2`, [channelId, targetId]
  )

  const now = Date.now()
  await pool.query(`
    INSERT INTO aaelink.messages (id, channel_id, user_id, content, type, created_at)
    VALUES ($1, $2, $3, $4, 'system', $5)
  `, [randomUUID(), channelId, uid, `removed <@${targetId}> from the channel`, now])

  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/conversations/members', _GET)
export const POST   = tracedRoute('POST', '/api/conversations/members', _POST)
export const DELETE = tracedRoute('DELETE', '/api/conversations/members', _DELETE)
