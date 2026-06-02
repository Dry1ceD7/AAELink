import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * GET /api/channel-info?channel_id=...
 *
 * Returns enriched channel details:
 *  - purpose, header, type, display_name
 *  - member_count (actual channel members, not workspace-wide)
 *  - pinned_count
 *  - created_by_username
 *  - last_message_at (timestamp of most recent message)
 *  - is_member (whether the current user is a member)
 */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const channelId = req.nextUrl.searchParams.get('channel_id') || ''
  if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })

  // Channel base info + creator username
  const { rows } = await pool.query<{
    id: string; name: string; display_name: string; type: string
    purpose: string; header: string; created_at: string
    created_by: string | null; creator_username: string | null
    workspace_id: string
  }>(
    `SELECT c.id, c.name, c.display_name, c.type, c.purpose, c.header,
            c.created_at::text AS created_at, c.created_by,
            u.username AS creator_username, c.workspace_id
     FROM aaelink.channels c
     LEFT JOIN aaelink.users u ON u.id = c.created_by
     WHERE c.id = $1`,
    [channelId]
  )
  const ch = rows[0]
  if (!ch) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Actual channel member count (from channel_members, not workspace_members)
  const { rows: memberRows } = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM aaelink.channel_members WHERE channel_id = $1`,
    [channelId]
  )
  let memberCount = Number(memberRows[0]?.cnt || 0)

  // Fallback: for DMs/group DMs without explicit channel_members, count from workspace_members
  if (memberCount === 0 && (ch.type === 'D' || ch.type === 'G')) {
    const { rows: wRows } = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM aaelink.workspace_members wm
       JOIN aaelink.channels c ON c.workspace_id = wm.workspace_id
       WHERE c.id = $1`,
      [channelId]
    )
    memberCount = Number(wRows[0]?.cnt || 0)
  }

  // Pinned count
  const { rows: pinRows } = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM aaelink.pinned_messages WHERE channel_id = $1`,
    [channelId]
  )
  const pinnedCount = Number(pinRows[0]?.cnt || 0)

  // Last message timestamp
  const { rows: lastMsg } = await pool.query<{ ts: string }>(
    `SELECT created_at::text AS ts FROM aaelink.messages
     WHERE channel_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [channelId]
  )
  const lastMessageAt = lastMsg[0] ? Number(lastMsg[0].ts) : null

  // Current user membership check
  const { rows: memberCheck } = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM aaelink.channel_members
     WHERE channel_id = $1 AND user_id = $2`,
    [channelId, uid]
  )
  const isMember = Number(memberCheck[0]?.cnt || 0) > 0

  return NextResponse.json({
    channel: {
      id: ch.id,
      name: ch.name,
      display_name: ch.display_name,
      type: ch.type,
      purpose: ch.purpose,
      header: ch.header,
      workspace_id: ch.workspace_id,
      created_at: Number(ch.created_at),
      created_by: ch.created_by,
      created_by_username: ch.creator_username,
      member_count: memberCount,
      pinned_count: pinnedCount,
      last_message_at: lastMessageAt,
      is_member: isMember
    }
  })
}

/** PATCH /api/channel-info — update channel purpose/header.  Body: { channel_id, purpose?, header? } */
async function _PATCH(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { channel_id?: string; purpose?: string; header?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }) }

  const { channel_id } = body
  if (!channel_id) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })

  const sets: string[] = []
  const vals: (string | number)[] = []
  let i = 1

  if (typeof body.purpose === 'string') {
    sets.push(`purpose = $${i++}`)
    vals.push(body.purpose.slice(0, 500))
  }
  if (typeof body.header === 'string') {
    sets.push(`header = $${i++}`)
    vals.push(body.header.slice(0, 500))
  }
  if (sets.length === 0) return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 })

  vals.push(channel_id)
  await pool.query(
    `UPDATE aaelink.channels SET ${sets.join(', ')} WHERE id = $${i}`,
    vals
  )

  // Audit log the change
  try {
    const changes: string[] = []
    if (typeof body.purpose === 'string') changes.push('purpose')
    if (typeof body.header === 'string') changes.push('header')
    await pool.query(
      `INSERT INTO aaelink.audit_log (id, actor_id, action, entity_type, entity_id, meta, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        uid,
        'channel_info_updated',
        'channel',
        channel_id,
        JSON.stringify({ fields: changes }),
        Date.now()
      ]
    )
  } catch { /* audit is best-effort */ }

  return NextResponse.json({ ok: true })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/channel-info', _GET)
export const PATCH  = tracedRoute('PATCH', '/api/channel-info', _PATCH)
