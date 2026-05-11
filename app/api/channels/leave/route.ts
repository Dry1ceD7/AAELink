import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { ensureSchema } from '@/lib/migrate'
import { readSessionUserId } from '@/lib/session'
import { tracedRoute } from '@/lib/tracedRoute'

/**
 * POST /api/channels/leave — leave a channel.
 *
 * Body: { channel_id: string }
 *
 * Constraints:
 *   - Cannot leave default channels (#general)
 *   - Cannot leave DM channels
 *   - Posts a system message on successful leave
 */
async function _POST(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { channel_id?: string }
  const channelId = String(body.channel_id || '').trim()
  if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })

  // Get channel info
  const { rows: chRows } = await pool.query<{
    type: string; workspace_id: string; is_default: boolean
  }>(
    `SELECT type, workspace_id, COALESCE(is_default, false) AS is_default
     FROM aaelink.channels WHERE id = $1`,
    [channelId]
  )
  if (!chRows[0]) return NextResponse.json({ error: 'channel_not_found' }, { status: 404 })

  const ch = chRows[0]

  // Cannot leave default channels
  if (ch.is_default) {
    return NextResponse.json({ error: 'cannot_leave_default_channel' }, { status: 403 })
  }

  // Cannot leave DM channels
  if (ch.type === 'D') {
    return NextResponse.json({ error: 'cannot_leave_dm' }, { status: 400 })
  }

  // Verify user is a member
  const { rows: membership } = await pool.query(
    `SELECT 1 FROM aaelink.channel_members WHERE channel_id = $1 AND user_id = $2`,
    [channelId, uid]
  )
  if (!membership[0]) return NextResponse.json({ error: 'not_a_member' }, { status: 400 })

  // Remove membership
  await pool.query(
    `DELETE FROM aaelink.channel_members WHERE channel_id = $1 AND user_id = $2`,
    [channelId, uid]
  )

  // Clean up related user data for this channel
  await pool.query(`DELETE FROM aaelink.starred_channels WHERE user_id = $1 AND channel_id = $2`, [uid, channelId]).catch(() => {})
  await pool.query(`DELETE FROM aaelink.channel_mutes WHERE user_id = $1 AND channel_id = $2`, [uid, channelId]).catch(() => {})
  await pool.query(`DELETE FROM aaelink.message_drafts WHERE user_id = $1 AND channel_id = $2`, [uid, channelId]).catch(() => {})

  // Post system message
  try {
    const { rows: uRows } = await pool.query<{ username: string }>(
      `SELECT username FROM aaelink.users WHERE id = $1`, [uid]
    )
    await pool.query(
      `INSERT INTO aaelink.messages (id, channel_id, user_id, body, root_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, '', $5, $5)`,
      [randomUUID(), channelId, uid, `_${uRows[0]?.username || 'Someone'} left the channel_`, Date.now()]
    )
  } catch { /* best-effort */ }

  return NextResponse.json({ ok: true, action: 'left' })
}

// ── Traced exports ──────────────────────────────────────────────────
export const POST   = tracedRoute('POST', '/api/channels/leave', _POST)
