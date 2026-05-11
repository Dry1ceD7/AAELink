import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * Channel members management.
 * GET  /api/channel-members?channel_id=...          → list members
 * POST /api/channel-members { channel_id, user_id } → add member (invite)
 * DELETE /api/channel-members?channel_id=...&user_id=... → remove member
 */

/** GET — list members of a channel. */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const channelId = req.nextUrl.searchParams.get('channel_id') || ''
  if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })

  // Get channel type
  const { rows: chRows } = await pool.query<{ type: string; workspace_id: string }>(
    `SELECT type, workspace_id FROM aaelink.channels WHERE id = $1`, [channelId]
  )
  const ch = chRows[0]
  if (!ch) return NextResponse.json({ error: 'channel_not_found' }, { status: 404 })

  let members: Array<{ user_id: string; username: string; first_name: string; last_name: string; platform_role: string; role: string; avatar_url: string | null }>

  if (ch.type === 'O') {
    // Public channel: all workspace members are implicit members
    const { rows } = await pool.query<{
      user_id: string; username: string; first_name: string; last_name: string; platform_role: string; role: string; avatar_url: string | null
    }>(
      `SELECT wm.user_id, u.username, u.first_name, u.last_name, u.platform_role, wm.role, u.avatar_url
       FROM aaelink.workspace_members wm
       JOIN aaelink.users u ON u.id = wm.user_id
       WHERE wm.workspace_id = $1
       ORDER BY u.username ASC LIMIT 200`,
      [ch.workspace_id]
    )
    members = rows
  } else {
    // Private or DM: use channel_members table
    const { rows } = await pool.query<{
      user_id: string; username: string; first_name: string; last_name: string; platform_role: string; role: string; avatar_url: string | null
    }>(
      `SELECT cm.user_id, u.username, u.first_name, u.last_name, u.platform_role, cm.role, u.avatar_url
       FROM aaelink.channel_members cm
       JOIN aaelink.users u ON u.id = cm.user_id
       WHERE cm.channel_id = $1
       ORDER BY u.username ASC LIMIT 200`,
      [channelId]
    )
    members = rows
  }

  return NextResponse.json({ members })
}

/** POST — invite a user to a private/group channel. */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { channel_id?: string; user_id?: string }
  const channelId = String(body.channel_id || '').trim()
  const targetUserId = String(body.user_id || '').trim()

  if (!channelId || !targetUserId) {
    return NextResponse.json({ error: 'channel_id_and_user_id_required' }, { status: 400 })
  }

  // Verify the channel exists and get its type
  const { rows: chRows } = await pool.query<{ type: string; workspace_id: string }>(
    `SELECT type, workspace_id FROM aaelink.channels WHERE id = $1`, [channelId]
  )
  const ch = chRows[0]
  if (!ch) return NextResponse.json({ error: 'channel_not_found' }, { status: 404 })

  // Verify target user exists
  const { rows: userRows } = await pool.query(`SELECT id FROM aaelink.users WHERE id = $1`, [targetUserId])
  if (!userRows[0]) return NextResponse.json({ error: 'user_not_found' }, { status: 404 })

  if (ch.type === 'O') {
    // Public channel: just add to workspace_members if not already
    await pool.query(
      `INSERT INTO aaelink.workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')
       ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      [ch.workspace_id, targetUserId]
    )
  } else {
    // Private/Group: add to channel_members
    const now = Date.now()
    await pool.query(
      `INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at) VALUES ($1, $2, 'member', $3)
       ON CONFLICT (channel_id, user_id) DO NOTHING`,
      [channelId, targetUserId, now]
    )
  }

  // Also create a system notification for the invited user
  const { rows: inviter } = await pool.query<{ username: string }>(
    `SELECT username FROM aaelink.users WHERE id = $1`, [uid]
  )
  const { rows: chInfo } = await pool.query<{ display_name: string; workspace_id: string }>(
    `SELECT display_name, workspace_id FROM aaelink.channels WHERE id = $1`, [channelId]
  )
  if (inviter[0] && chInfo[0]) {
    await pool.query(
      `INSERT INTO aaelink.notifications (id, user_id, kind, title, body, workspace_id, channel_id, created_at)
       VALUES ($1, $2, 'system', $3, $4, $5, $6, $7)`,
      [
        randomUUID(), targetUserId,
        `Added to #${chInfo[0].display_name}`,
        `@${inviter[0].username} added you to #${chInfo[0].display_name}`,
        chInfo[0].workspace_id, channelId, Date.now()
      ]
    )
  }

  return NextResponse.json({ ok: true })
}

/** DELETE — remove a user from a private/group channel (or leave). */
async function _DELETE(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const channelId = req.nextUrl.searchParams.get('channel_id') || ''
  let targetUserId = req.nextUrl.searchParams.get('user_id') || ''

  // Support self-leave via user_id=me
  if (targetUserId === 'me') targetUserId = uid

  if (!channelId || !targetUserId) {
    return NextResponse.json({ error: 'channel_id_and_user_id_required' }, { status: 400 })
  }

  await pool.query(
    `DELETE FROM aaelink.channel_members WHERE channel_id = $1 AND user_id = $2`,
    [channelId, targetUserId]
  )

  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/channel-members', _GET)
export const POST   = tracedRoute('POST', '/api/channel-members', _POST)
export const DELETE = tracedRoute('DELETE', '/api/channel-members', _DELETE)
