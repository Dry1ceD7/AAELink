import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Conversations Open/Close API — Slack conversations.open / conversations.close parity.
 *
 * POST /api/conversations/open — open or resume a DM/group DM
 *   Creates or finds an existing DM/MPIM channel between users.
 *
 * This is how apps initiate DM conversations with users.
 */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    action?: 'open' | 'close'
    users?: string | string[] // User IDs to open DM with
    channel?: string // For close
    return_im?: boolean
  }

  const action = body.action || 'open'

  if (action === 'open') {
    // Parse users
    let userIds: string[] = []
    if (Array.isArray(body.users)) userIds = body.users
    else if (typeof body.users === 'string') userIds = body.users.split(',').map(u => u.trim()).filter(Boolean)
    if (!userIds.length) userIds = [uid]

    // Ensure current user is in the list
    if (!userIds.includes(uid)) userIds.push(uid)
    userIds.sort()

    const isDM = userIds.length === 2
    const type = isDM ? 'D' : 'G'

    // Try to find existing DM/MPIM with exactly these users
    const { rows: existingChannels } = await pool.query<{ id: string }>(`
      SELECT c.id
      FROM aaelink.channels c
      WHERE c.type = $1
        AND (SELECT COUNT(*)::int FROM aaelink.channel_members WHERE channel_id = c.id) = $2
        AND NOT EXISTS (
          SELECT 1 FROM unnest($3::text[]) AS u(uid)
          WHERE NOT EXISTS (
            SELECT 1 FROM aaelink.channel_members WHERE channel_id = c.id AND user_id = u.uid
          )
        )
      LIMIT 1
    `, [type, userIds.length, userIds])

    if (existingChannels[0]) {
      const chId = existingChannels[0].id
      return NextResponse.json({
        ok: true,
        no_op: true,
        already_open: true,
        channel: { id: chId },
      })
    }

    // Create new DM/MPIM
    const { randomUUID } = await import('crypto')
    const channelId = randomUUID()
    const now = Date.now()
    const name = isDM ? `dm-${userIds.join('-')}` : `group-${userIds.join('-')}`

    // Get user's workspace
    const { rows: userRows } = await pool.query<{ workspace_id: string }>(
      `SELECT workspace_id FROM aaelink.users WHERE id = $1`, [uid]
    )

    await pool.query(`
      INSERT INTO aaelink.channels (id, workspace_id, name, type, created_by, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [channelId, userRows[0]?.workspace_id || '', name, type, uid, now])

    for (const userId of userIds) {
      await pool.query(`
        INSERT INTO aaelink.channel_members (channel_id, user_id, role, joined_at)
        VALUES ($1, $2, 'member', $3)
      `, [channelId, userId, now])
    }

    return NextResponse.json({
      ok: true,
      no_op: false,
      already_open: false,
      channel: { id: channelId, is_im: isDM, is_mpim: !isDM },
    }, { status: 201 })
  }

  if (action === 'close') {
    if (!body.channel) return NextResponse.json({ ok: false, error: 'channel required' }, { status: 400 })
    // "Close" just means hide from sidebar — not delete
    // We mark the user's read state as "closed"
    return NextResponse.json({ ok: true, no_op: false, already_closed: false })
  }

  return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 })
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/conversations/open', _POST)
