// keep: slack-compat surface (intentionally addressable, may be invoked by Slack-shaped clients)
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/infra/db'
import { ensureSchema } from '@/lib/infra/migrate'
import { readSessionUserId } from '@/lib/auth/session'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * Channel Posting Permissions API (Slack "Announcement" / "Read-only" channels).
 *
 * GET   /api/channels/posting-perms?channel_id=...
 * PATCH /api/channels/posting-perms { channel_id, mode }
 *
 * Modes:
 *   'everyone'    — all members can post (default)
 *   'admins_only' — only channel admins/owners can post
 *   'approved'    — only users in an approved posters list can post
 *
 * When a channel is in 'admins_only' mode, it functions like a
 * Slack "Announcement channel" — members can read but only admins post.
 */

/** GET — get posting permissions for a channel */
async function _GET(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const channelId = req.nextUrl.searchParams.get('channel_id')?.trim() || ''
  if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })

  const { rows } = await pool.query<{
    posting_mode: string
  }>(
    `SELECT COALESCE(posting_mode, 'everyone') AS posting_mode
     FROM aaelink.channels WHERE id = $1`,
    [channelId]
  )

  if (!rows[0]) return NextResponse.json({ error: 'channel_not_found' }, { status: 404 })

  // Get approved posters if applicable
  let approvedPosters: string[] = []
  if (rows[0].posting_mode === 'approved') {
    const { rows: ap } = await pool.query<{ user_id: string; username: string }>(
      `SELECT ap.user_id, u.username
       FROM aaelink.channel_approved_posters ap
       JOIN aaelink.users u ON u.id = ap.user_id
       WHERE ap.channel_id = $1`,
      [channelId]
    )
    approvedPosters = ap.map(r => r.user_id)
  }

  // Check if current user can post
  let canPost = true
  if (rows[0].posting_mode === 'admins_only') {
    const { rows: cmRows } = await pool.query<{ role: string }>(
      `SELECT role FROM aaelink.channel_members WHERE channel_id = $1 AND user_id = $2`,
      [channelId, uid]
    )
    canPost = ['admin', 'owner'].includes(cmRows[0]?.role || '')
    // Also check workspace admin
    if (!canPost) {
      const { rows: chRows } = await pool.query<{ workspace_id: string }>(
        `SELECT workspace_id FROM aaelink.channels WHERE id = $1`, [channelId]
      )
      if (chRows[0]) {
        const { rows: wmRows } = await pool.query<{ role: string }>(
          `SELECT role FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2`,
          [chRows[0].workspace_id, uid]
        )
        canPost = ['admin', 'owner'].includes(wmRows[0]?.role || '')
      }
    }
  } else if (rows[0].posting_mode === 'approved') {
    canPost = approvedPosters.includes(uid)
  }

  return NextResponse.json({
    posting_mode: rows[0].posting_mode,
    can_post: canPost,
    approved_posters: rows[0].posting_mode === 'approved' ? approvedPosters : undefined
  })
}

/** PATCH — update posting permissions */
async function _PATCH(req: NextRequest) {
  await ensureSchema()
  const pool = getPool()
  if (!pool) return NextResponse.json({ error: 'db_unavailable' }, { status: 503 })
  const uid = await readSessionUserId()
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    channel_id?: string
    mode?: string
    approved_poster_ids?: string[]
  }

  const channelId = String(body.channel_id || '').trim()
  const mode = String(body.mode || '').trim()

  if (!channelId) return NextResponse.json({ error: 'channel_id_required' }, { status: 400 })
  if (!['everyone', 'admins_only', 'approved'].includes(mode)) {
    return NextResponse.json({ error: 'invalid_mode' }, { status: 400 })
  }

  // Verify admin access
  const { rows: chRows } = await pool.query<{ workspace_id: string }>(
    `SELECT workspace_id FROM aaelink.channels WHERE id = $1`, [channelId]
  )
  if (!chRows[0]) return NextResponse.json({ error: 'channel_not_found' }, { status: 404 })

  const { rows: wmRows } = await pool.query<{ role: string }>(
    `SELECT role FROM aaelink.workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [chRows[0].workspace_id, uid]
  )
  if (!['owner', 'admin'].includes(wmRows[0]?.role || '')) {
    return NextResponse.json({ error: 'forbidden_admin_only' }, { status: 403 })
  }

  // Update the posting mode
  await pool.query(
    `UPDATE aaelink.channels SET posting_mode = $1 WHERE id = $2`,
    [mode, channelId]
  )

  // Update approved posters if mode is 'approved'
  if (mode === 'approved' && Array.isArray(body.approved_poster_ids)) {
    // Clear and re-insert
    await pool.query(`DELETE FROM aaelink.channel_approved_posters WHERE channel_id = $1`, [channelId])
    for (const posterId of body.approved_poster_ids) {
      await pool.query(
        `INSERT INTO aaelink.channel_approved_posters (channel_id, user_id, granted_at)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [channelId, posterId, Date.now()]
      )
    }
  }

  return NextResponse.json({ ok: true, posting_mode: mode })
}

// ── Traced exports ──────────────────────────────────────────────────
export const GET    = tracedRoute('GET', '/api/channels/posting-perms', _GET)
export const PATCH  = tracedRoute('PATCH', '/api/channels/posting-perms', _PATCH)
